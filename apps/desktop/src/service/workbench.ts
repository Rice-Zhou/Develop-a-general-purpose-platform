import { join } from "node:path";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { z } from "zod";
import { DataStore } from "../../../../packages/storage/src/database";
import { SnapshotStore } from "../../../../packages/storage/src/snapshot-store";
import type { Request } from "../../../../packages/contracts/src/ipc";
import {
  AIProfileDraftSchema,
  type AIProfile,
  type PublicAIProfile,
  type CliConfiguration,
} from "../../../../packages/contracts/src/analysis";
import { AppError } from "../../../../packages/contracts/src/error";
import type {
  ContextSnapshot,
  Project,
  Task,
} from "../../../../packages/contracts/src/models";
import { DocumentService } from "../../../../packages/core/src/documents/document-service";
import { LocalDocumentSource } from "../../../../packages/adapters/src/documents/local-source";
import { FeishuCliSource } from "../../../../packages/adapters/src/feishu/document-source";
import { ParserClient } from "../../../../packages/adapters/src/documents/parser-client";
import { GitRepositoryAdapter } from "../../../../packages/adapters/src/git/repository";
import { ContextReader } from "../../../../packages/core/src/context/context-reader";
import { SearchService } from "../../../../packages/core/src/search/search-service";
import { RequirementService } from "../../../../packages/core/src/requirements/requirement-service";
import { AnalysisPipeline } from "../../../../packages/core/src/analysis/analysis-pipeline";
import { EvidenceValidator } from "../../../../packages/core/src/analysis/evidence-validator";
import { ChatCompletionsTransport } from "../../../../packages/adapters/src/ai/chat-completions";
import { SubscriptionTransport } from "../../../../packages/adapters/src/ai/subscription";
import { runProcess } from "../../../../packages/adapters/src/process/run-process";
import type {
  TaskRuntime,
  TaskService,
} from "../../../../packages/core/src/tasks/task-service";
const publicProfile = (profile: AIProfile): PublicAIProfile => {
  const { credentialRef, ...draft } = profile;
  return { ...draft, hasCredential: Boolean(credentialRef) };
};
export class Workbench implements TaskRuntime {
  readonly content: SnapshotStore;
  readonly search: SearchService;
  readonly requirements: RequirementService;
  readonly documents: DocumentService;
  constructor(
    private readonly store: DataStore,
    private readonly git: GitRepositoryAdapter,
    private readonly dataPath: string,
    worker: string,
    private readonly resolveKey: (
      profileId: string,
      ref: string,
    ) => Promise<string>,
  ) {
    this.content = new SnapshotStore(join(dataPath, "content"));
    this.search = new SearchService(store);
    this.requirements = new RequirementService(store);
    const local = new LocalDocumentSource();
    const feishu = new FeishuCliSource(() =>
      store.getSetting<CliConfiguration>("cli"),
    );
    this.documents = new DocumentService(
      {
        fetch: (binding, signal) =>
          binding.kind === "feishu"
            ? feishu.fetch(binding, signal)
            : local.fetch(binding, signal),
      },
      new ParserClient(worker, dataPath),
      this.content,
      store,
    );
  }
  reader(projectId: string, contextId: string): ContextReader {
    const context = this.store.getContext(contextId);
    if (context.projectId !== projectId)
      throw new AppError("CONTEXT_MISMATCH", "上下文不属于当前项目");
    return this.bound(context);
  }
  private bound(context: ContextSnapshot): ContextReader {
    return new ContextReader(context, this.store, this.git, this.content);
  }
  captureDocuments(project: Project, signal: AbortSignal) {
    return this.documents.captureProject(project, signal);
  }
  indexContext(context: ContextSnapshot, signal: AbortSignal) {
    return this.search.index(this.bound(context), signal);
  }
  profiles(): AIProfile[] {
    return this.store.getSetting<AIProfile[]>("profiles") ?? [];
  }
  profile(id: string): AIProfile {
    const profile = this.profiles().find((p) => p.id === id);
    if (!profile)
      throw new AppError(
        "MODEL_NOT_CONFIGURED",
        "模型或订阅工具连接不存在，请在设置配置并关联项目",
      );
    return profile;
  }
  saveProfile(value: unknown): PublicAIProfile {
    const raw = z
      .object({
        id: z.uuid(),
        credentialRef: z.uuid().nullable(),
        draft: AIProfileDraftSchema,
      })
      .strict()
      .parse(value);
    const profile: AIProfile = {
      ...raw.draft,
      id: raw.id,
      credentialRef: raw.credentialRef,
    };
    this.store.setSetting("profiles", [
      ...this.profiles().filter((p) => p.id !== profile.id),
      profile,
    ]);
    return publicProfile(profile);
  }
  deleteProfile(id: string): void {
    this.profile(id);
    this.store.setSetting(
      "profiles",
      this.profiles().filter((p) => p.id !== id),
    );
  }
  configurationHash(project: Project): string {
    if (!project.aiProfileId) throw new AppError("MODEL_NOT_CONFIGURED", "请在项目配置选择模型 API 或订阅工具连接");
    return createHash("sha256").update(JSON.stringify(this.profile(project.aiProfileId))).digest("hex");
  }
  private async transport(profile: AIProfile, assertCurrent?: () => void) {
    if (profile.kind === "api")
      return new ChatCompletionsTransport(profile, () =>
        profile.credentialRef
          ? this.resolveKey(profile.id, profile.credentialRef)
          : Promise.resolve(null),
        assertCurrent,
      );
    const cwd = join(this.dataPath, "subscription-workspace");
    await mkdir(cwd, { recursive: true });
    return new SubscriptionTransport(profile, cwd, runProcess, assertCurrent);
  }
  async analyze(
    task: Task,
    context: ContextSnapshot,
    signal: AbortSignal,
    progress: (message: string) => void,
  ) {
    const project = this.store.getProject(task.projectId);
    const assertCurrent = () => {
      const current = this.store.getProject(task.projectId);
      if (!current.enabled || current.revision !== task.projectRevision ||
        current.revision !== context.configRevision ||
        this.configurationHash(current) !== task.executionConfigurationHash)
        throw new AppError("PROJECT_CHANGED", "项目或 AI 连接配置已改变，未继续发送材料，请重新运行");
    };
    assertCurrent();
    if (!project.aiProfileId)
      throw new AppError(
        "MODEL_NOT_CONFIGURED",
        "请在项目配置选择模型 API 或订阅工具连接",
      );
    const model = await this.transport(this.profile(project.aiProfileId), assertCurrent);
    const pipeline = new AnalysisPipeline(
      this.bound(context),
      this.search,
      this.requirements,
      model,
      progress,
    );
    if (task.kind === "EXTRACT_REQUIREMENTS")
      return {
        kind: "extraction" as const,
        set: await pipeline.extract(
          this.store.latestRequirementSet(task.projectId)?.revision ?? 0,
          signal,
        ),
      };
    if (!task.requirementSetId)
      throw new AppError("REQUIREMENTS_EMPTY", "请选择一个需求版本");
    return {
      kind: "report" as const,
      report: await pipeline.check(
        task,
        this.store.getRequirementSet(task.projectId, task.requirementSetId),
        signal,
      ),
    };
  }
  cliConfiguration() {
    const appData = process.env.APPDATA ?? "";
    const user = process.env.USERPROFILE ?? "";
    const lark = join(
      appData,
      "npm/node_modules/@larksuite/cli/bin/lark-cli.exe",
    );
    const codex = join(
      appData,
      "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    );
    const claude = join(user, ".local/bin/claude.exe");
    return {
      larkExecutable: existsSync(lark) ? lark : "",
      identity: "user" as const,
      ...this.store.getSetting<CliConfiguration>("cli"),
      codexExecutable: existsSync(codex) ? codex : "",
      claudeExecutable: existsSync(claude) ? claude : "",
    };
  }
  async probe(id: string) {
    const profile = this.profile(id);
    const signal = AbortSignal.timeout(30000);
    if (profile.kind === "api") {
      const model = await this.transport({ ...profile, outboundEnabled: true });
      await model.complete(
        [
          { role: "system", content: "Return only JSON." },
          {
            role: "user",
            content:
              'Return {"probe":true}. No project materials are included.',
          },
        ],
        [],
        signal,
      );
      return {
        available: true,
        detail: "已收到所配置模型的协议响应；此测试未发送项目材料",
      };
    }
    const help = await runProcess(
      profile.executable,
      [
        profile.kind === "codex" ? "exec" : "--help",
        ...(profile.kind === "codex" ? ["--help"] : []),
      ],
      { cwd: this.dataPath, signal },
    );
    const required =
      profile.kind === "codex"
        ? [
            "--sandbox",
            "--ignore-user-config",
            "--ignore-rules",
            "--json",
            "--disable",
          ]
        : [
            "--tools",
            "--strict-mcp-config",
            "--setting-sources",
            "--output-format",
          ];
    if (!required.every((flag) => help.includes(flag)))
      throw new AppError(
        "CLI_CAPABILITY_MISSING",
        "工具版本缺少必要的非交互或权限控制参数，不能用于自动分析",
      );
    return {
      available: true,
      detail:
        "已验证本机命令参数能力；登录、订阅额度和实际只读执行仍在分析调用时验证",
    };
  }
  async dispatch(request: Request, tasks: TaskService): Promise<unknown> {
    switch (request.method) {
      case "getReport": {
        const {projectId, reportId} = request.params;
        const report = this.store.getReport(projectId, reportId);
        return {report, requirements: this.store.getRequirementSet(projectId, report.requirementSetId)};
      }
      case "readDocumentBlock": {
        const p = request.params;
        const reader = this.reader(p.projectId, p.contextId);
        await reader.verifySources();
        return reader.readBlock(p.documentSnapshotId, p.blockId);
      }
      case "getWorkspace": {
        const projectId = request.params.projectId;
        this.store.getProject(projectId);
        const context = this.store.latestContext(projectId);
        return {
          context,
          documents: context
            ? context.documents.map((ref) =>
                this.store.getDocument(projectId, ref.id),
              )
            : [],
          requirements: this.store.latestRequirementSet(projectId),
          reports: this.store.listReports(projectId),
        };
      }
      case "saveRequirementRevision": {
        const p = request.params;
        const reader = this.reader(p.projectId, p.contextId);
        await reader.verifySources();
        return this.requirements.saveRevision(
          reader,
          p.items,
          p.expectedRevision,
        );
      }
      case "extractRequirements":
        return tasks.enqueue(request.params.projectId, "EXTRACT_REQUIREMENTS");
      case "checkRequirements":
        this.store.getRequirementSet(
          request.params.projectId,
          request.params.requirementSetId,
        );
        return tasks.enqueue(
          request.params.projectId,
          "CHECK_REQUIREMENTS",
          1,
          request.params.requirementSetId,
        );
      case "searchEvidence": {
        const p = request.params;
        const reader = this.reader(p.projectId, p.contextId);
        await reader.verifySources();
        return this.search.search(reader.context, p.query);
      }
      case "readEvidence": {
        const p = request.params;
        const reader = this.reader(p.projectId, p.contextId);
        await reader.verifySources();
        await new EvidenceValidator().validate([p.evidence], reader);
        return p.evidence.kind === "document"
          ? reader.readBlock(p.evidence.documentSnapshotId, p.evidence.blockId)
          : reader.readCode(
              p.evidence.bindingId,
              p.evidence.path,
              p.evidence.startLine,
              p.evidence.endLine,
            );
      }
      case "getAIProfiles":
        return this.profiles().map(publicProfile);
      case "getCliConfiguration":
        return this.cliConfiguration();
      case "saveCliConfiguration":
        this.store.setSetting("cli", request.params.configuration);
        return request.params.configuration;
      case "probeExecutor":
        return this.probe(request.params.id);
      case "probeFeishu": {
        const config = this.store.getSetting<CliConfiguration>("cli");
        if (!config?.larkExecutable)
          throw new AppError("FEISHU_NOT_CONFIGURED", "请先保存飞书 CLI 路径");
        const help = await runProcess(
          config.larkExecutable,
          ["docs", "+fetch", "--api-version", "v2", "--help"],
          { cwd: this.dataPath },
        );
        if (!help.includes("--detail") || !help.includes("--doc-format"))
          throw new AppError(
            "CLI_CAPABILITY_MISSING",
            "飞书 CLI 缺少 v2 XML 及块 ID 导出能力",
          );
        return {
          available: true,
          detail: "已验证飞书 CLI v2 读取参数；文档授权将在读取关联文档时验证",
        };
      }
      default:
        throw new AppError("HOST_ONLY", "该操作只能通过桌面系统能力执行");
    }
  }
  exportMarkdown(projectId: string, id: string): string {
    const report = this.store.getReport(projectId, id);
    const escape = (text: string) => text.replace(/[\\`*_[\]<>!|]/g, "\\$&");
    return (
      `# 需求核对报告\n\n项目：${escape(projectId)}\n\n上下文：${escape(report.contextSnapshotId)}\n\n静态分析，未运行验证。\n\n` +
      report.findings
        .map(
          (f) =>
            `## ${escape(f.requirementId)} — ${f.status}\n\n${escape(f.explanation)}\n\n检查范围：${f.checkedScope.map(escape).join("；")}\n\n证据：${f.evidenceIds.map(escape).join("、")}\n`,
        )
        .join("\n") +
      "\n## 证据引用\n\n" +
      report.evidenceRefs
        .map((e) =>
          e.kind === "code"
            ? `- ${escape(e.id)}：${escape(e.bindingId)} / ${escape(e.commit)} / ${escape(e.path)}:${e.startLine}-${e.endLine}，SHA256 ${e.snippetHash}`
            : `- ${escape(e.id)}：文档 ${escape(e.documentSnapshotId)} / ${escape(e.blockId)}，SHA256 ${e.quoteHash}`,
        )
        .join("\n") +
      "\n\n## 限制\n\n" +
      report.limitations.map((s) => "- " + escape(s)).join("\n")
    );
  }
}
