import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { JiraCatalogue } from "../../../../../packages/contracts/src/issues";

type JiraProject = JiraCatalogue["projects"][number];
const projectLabel = (project: JiraProject) => `${project.name}（${project.key}）`;

export function JiraProjectPicker({ projects, value, disabled, onChange }: {
  projects: JiraProject[];
  value?: string;
  disabled: boolean;
  onChange: (key: string | null) => void;
}) {
  const id = useId();
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = projects.find((project) => project.key === value);
  const search = query?.trim().toLocaleLowerCase();
  const matches = query === null ? projects : projects.filter((project) =>
    `${project.name} ${project.key}`.toLocaleLowerCase().includes(search ?? ""),
  );
  const expanded = open && !disabled;
  const active = matches[activeIndex];

  useEffect(() => {
    if (expanded) list.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded]);

  function choose(project: JiraProject) {
    onChange(project.key);
    setQuery(null);
    setOpen(false);
  }

  function showOptions() {
    setOpen(true);
    setActiveIndex(Math.max(matches.findIndex((project) => project.key === value), 0));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && expanded) {
      event.preventDefault();
      if (active) choose(active);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setOpen(true);
    setActiveIndex((index) => event.key === "ArrowDown"
      ? Math.min(expanded ? index + 1 : 0, matches.length - 1)
      : Math.max(expanded ? index - 1 : matches.length - 1, 0));
  }

  return <div className="jira-project-picker" onBlur={(event) => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label htmlFor={id}>Jira 项目</label>
    <input
      id={id}
      role="combobox"
      required
      autoComplete="off"
      spellCheck={false}
      placeholder="输入项目名称或 Key，选择匹配的项目"
      disabled={disabled}
      value={query ?? (selected ? projectLabel(selected) : "")}
      aria-autocomplete="list"
      aria-expanded={expanded}
      aria-controls={`${id}-options`}
      aria-activedescendant={expanded && active ? `${id}-option-${activeIndex}` : undefined}
      onFocus={showOptions}
      onClick={showOptions}
      onChange={(event) => {
        setQuery(event.target.value);
        setActiveIndex(0);
        setOpen(true);
        onChange(null);
      }}
      onKeyDown={onKeyDown}
    />
    {expanded && <ul id={`${id}-options`} className="jira-project-options" role="listbox" aria-label="匹配的 Jira 项目" ref={list}>
      {matches.map((project, index) => <li
        id={`${id}-option-${index}`}
        role="option"
        key={project.key}
        aria-selected={project.key === value}
        className={index === activeIndex ? "is-active" : ""}
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => setActiveIndex(index)}
        onClick={() => choose(project)}
      >{projectLabel(project)}</li>)}
      {!matches.length && <li role="presentation"><span role="status">未找到匹配的 Jira 项目</span></li>}
    </ul>}
  </div>;
}
