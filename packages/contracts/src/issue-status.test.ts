import { expect, it } from "vitest";
import { isIssueStatusIndexed } from "./issues";

it.each(["完成", "已完成", "Done", "Completed", " done "])("excludes completed Jira status %s", status => {
  expect(isIssueStatusIndexed("jira-dc", status)).toBe(false);
  expect(isIssueStatusIndexed("jira-cloud", status)).toBe(false);
  expect(isIssueStatusIndexed("trinity", status)).toBe(true);
});
it.each(["待处理", "待验收", "测试中", "已关闭", "Open", "Reopened", "未知自定义状态"])("includes non-completed Jira status %s", status => {
  expect(isIssueStatusIndexed("jira-dc", status)).toBe(true);
});
