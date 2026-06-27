const CONFIG = {
  dataFile: "sky_fortress.txt",
  pinnedRoles: ["车头", "机动车头", "车身"],
  commentPrefixes: ["#", "//"],
};

const state = {
  records: [],
  warnings: [],
  query: "",
  role: "all",
};

const els = {
  sourceStatus: document.querySelector("#sourceStatus"),
  searchInput: document.querySelector("#searchInput"),
  clearButton: document.querySelector("#clearButton"),
  statsGrid: document.querySelector("#statsGrid"),
  filterRow: document.querySelector("#filterRow"),
  resultTitle: document.querySelector("#resultTitle"),
  resultMeta: document.querySelector("#resultMeta"),
  statusLine: document.querySelector("#statusLine"),
  resultTable: document.querySelector("#resultTable"),
  resultList: document.querySelector("#resultList"),
};

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toLocaleLowerCase("zh-CN");
}

function normalizeLine(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isComment(line) {
  return CONFIG.commentPrefixes.some((prefix) => line.startsWith(prefix));
}

function splitNames(value) {
  const parts = [];
  let buffer = "";
  let depth = 0;

  for (const char of String(value || "")) {
    if (char === "（" || char === "(") {
      depth += 1;
      buffer += char;
      continue;
    }

    if (char === "）" || char === ")") {
      depth = Math.max(0, depth - 1);
      buffer += char;
      continue;
    }

    if ((char === "，" || char === ",") && depth === 0) {
      if (buffer.trim()) parts.push(buffer.trim());
      buffer = "";
      continue;
    }

    buffer += char;
  }

  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function parseNameToken(token) {
  const cleanedToken = String(token || "").trim().replace(/[，,]+$/, "");
  const match = cleanedToken.match(/^(.+?)[（(]([^（）()]*)[）)]$/);
  if (!match) {
    return {
      name: cleanedToken,
      condition: "",
    };
  }

  return {
    name: match[1].trim(),
    condition: match[2].trim(),
  };
}

function parseRoleLine(line) {
  const titleFirst = line.match(/^(.+?)[（(]\s*(\d+)\s*[）)]\s*[：:]\s*(.*)$/);
  if (titleFirst) {
    return {
      role: titleFirst[1],
      expectedCount: Number(titleFirst[2]),
      body: titleFirst[3],
    };
  }

  const countFirst = line.match(/^[（(]\s*(\d+)\s*[）)]\s*([^：:]+)\s*[：:]\s*(.*)$/);
  if (countFirst) {
    return {
      role: countFirst[2],
      expectedCount: Number(countFirst[1]),
      body: countFirst[3],
    };
  }

  const plainRole = line.match(/^([^：:]+)\s*[：:]\s*(.*)$/);
  if (plainRole && !plainRole[1].includes("，") && !plainRole[1].includes(",")) {
    return {
      role: plainRole[1],
      expectedCount: null,
      body: plainRole[2],
    };
  }

  return null;
}

function normalizeRole(role) {
  const value = normalize(role);
  if (value.includes("机动车头")) return "机动车头";
  if (value.includes("车头")) return "车头";
  if (value.includes("车身")) return "车身";
  return role.trim() || "未分组";
}

function splitFields(line) {
  return line
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseStructuredRecord(line) {
  const fields = splitFields(line);
  const idIndex = fields.findIndex((field) => /^\d{6,15}$/.test(field));
  if (idIndex < 0) return null;

  return {
    name: fields.slice(0, idIndex).join("，").trim(),
    id: fields[idIndex],
    condition: fields[idIndex + 1] || "",
    inGroup: fields[idIndex + 2] || "",
  };
}

function parenBalance(value) {
  let balance = 0;
  for (const char of String(value || "")) {
    if (char === "（" || char === "(") balance += 1;
    if (char === "）" || char === ")") balance -= 1;
  }
  return balance;
}

function toLogicalLines(text) {
  const logicalLines = [];
  let pending = "";
  let pendingLineNo = 0;
  let balance = 0;

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = normalizeLine(rawLine);
    if (!line) return;

    if (!pending) {
      pending = line;
      pendingLineNo = lineNo;
      balance = parenBalance(line);
    } else {
      pending += line;
      balance += parenBalance(line);
    }

    if (balance <= 0) {
      logicalLines.push({
        lineNo: pendingLineNo,
        rawLine: pending,
        line: pending,
      });
      pending = "";
      pendingLineNo = 0;
      balance = 0;
    }
  });

  if (pending) {
    logicalLines.push({
      lineNo: pendingLineNo,
      rawLine: pending,
      line: pending,
    });
  }

  return logicalLines;
}

function conditionTagClass(record) {
  const condition = normalize(record.condition);
  const role = normalize(record.role);

  if (condition === "难说") return "tag-condition-danger";
  if (condition.includes("难说")) return "tag-condition-warn";
  if (condition.includes("在线就去")) return "tag-condition-info";
  if (condition.includes("包去")) return "tag-condition-success";
  if (role.includes("车头")) return "tag-condition-success";
  return "tag-condition-muted";
}

function conditionLabel(record) {
  if (record.condition) return record.condition;
  if (normalize(record.role).includes("车头")) return "车头";
  return "未注明";
}

function renderConditionTag(record) {
  return `<span class="tag ${conditionTagClass(record)}">${escapeHtml(conditionLabel(record))}</span>`;
}

function inGroupLabel(record) {
  return record.inGroup || "待确认";
}

function parseSkyData(text) {
  const records = [];
  const warnings = [];
  const expectedByRole = new Map();
  let currentRole = "未分组";

  toLogicalLines(text).forEach(({ rawLine, line, lineNo }) => {
    if (!line || isComment(line)) return;
    if (line.startsWith("兵工厂情况") || line.startsWith("堡垒情况")) return;
    if (
      normalize(line).includes("类别") &&
      normalize(line).includes("名称") &&
      normalize(line).includes("到位条件")
    ) {
      return;
    }

    const roleMatch = parseRoleLine(line);
    if (roleMatch) {
      const expectedCount = roleMatch.expectedCount;
      const role = normalizeRole(roleMatch.role);
      const body = roleMatch.body.trim();
      currentRole = role;
      if (expectedCount) {
        expectedByRole.set(role, expectedCount);
      }

      const names = splitNames(body);
      names.forEach((token) => {
        const parsed = parseNameToken(token);
        if (!parsed.name) return;
        records.push({
          role,
          expectedCount,
          name: parsed.name,
          id: "",
          condition: parsed.condition,
          inGroup: "待确认",
          lineNo,
          raw: rawLine,
        });
      });
      return;
    }

    const structured = parseStructuredRecord(line);
    if (structured) {
      records.push({
        role: currentRole,
        expectedCount: null,
        name: structured.name,
        id: structured.id,
        condition: structured.condition,
        inGroup: structured.inGroup || "待确认",
        lineNo,
        raw: rawLine,
      });
      return;
    }

    const parsed = parseNameToken(line);
    if (!parsed.name) {
      warnings.push(`第 ${lineNo} 行未识别：${line}`);
      return;
    }

    records.push({
      role: currentRole,
      expectedCount: null,
      name: parsed.name,
      id: "",
      condition: parsed.condition,
      inGroup: "待确认",
      lineNo,
      raw: rawLine,
    });
  });

  const roleCounts = countBy(records, "role");
  expectedByRole.forEach((expectedCount, role) => {
    const actualCount = roleCounts[role] || 0;
    if (actualCount !== expectedCount) {
      warnings.push(`${role} 标注 ${expectedCount} 人，实际解析 ${actualCount} 人`);
    }
  });

  return { records, warnings };
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "未分组";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function getRoles(records) {
  const seen = [];
  records.forEach((record) => {
    if (!seen.includes(record.role)) seen.push(record.role);
  });

  const pinned = CONFIG.pinnedRoles.filter((role) => seen.includes(role));
  const rest = seen.filter((role) => !pinned.includes(role));
  return [...pinned, ...rest];
}

function getFilteredRecords() {
  const terms = String(state.query || "")
    .trim()
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);

  return state.records.filter((record) => {
    if (state.role !== "all" && record.role !== state.role) return false;
    if (!terms.length) return true;

    const haystack = normalize([
      record.role,
      record.name,
      record.id,
      record.condition,
      record.inGroup,
    ].join(" "));

    return terms.every((term) => haystack.includes(term));
  });
}

function renderStats(filteredRecords) {
  const roleCounts = countBy(state.records, "role");
  const topRoles = getRoles(state.records).slice(0, 3);

  els.statsGrid.innerHTML = [
    ["总人数", state.records.length],
    ["当前命中", filteredRecords.length],
    ["分组数", getRoles(state.records).length],
    ...topRoles.map((role) => [role, roleCounts[role] || 0]),
  ]
    .slice(0, 6)
    .map(
      ([label, value]) => `
        <div class="stat-item">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `,
    )
    .join("");
}

function renderFilters() {
  const roleCounts = countBy(state.records, "role");
  const buttons = [
    { id: "all", label: "全部", count: state.records.length },
    ...getRoles(state.records).map((role) => ({
      id: role,
      label: role,
      count: roleCounts[role] || 0,
    })),
  ];

  els.filterRow.innerHTML = buttons
    .map(
      (item) => `
        <button
          class="filter-button ${state.role === item.id ? "active" : ""}"
          type="button"
          data-role="${escapeHtml(item.id)}"
        >
          ${escapeHtml(item.label)} ${escapeHtml(item.count)}
        </button>
      `,
    )
    .join("");
}

function groupBy(records, getKey) {
  const groups = [];
  const indexByKey = new Map();

  records.forEach((record) => {
    const key = getKey(record);
    if (!indexByKey.has(key)) {
      indexByKey.set(key, groups.length);
      groups.push({ key, records: [] });
    }
    groups[indexByKey.get(key)].records.push(record);
  });

  return groups;
}

function renderRecordTable(records) {
  return `
    <table>
      <thead>
        <tr>
          <th>名称</th>
          <th>ID</th>
          <th>到位条件</th>
          <th>是否在群</th>
        </tr>
      </thead>
      <tbody>
        ${records
          .map(
            (record) => `
              <tr>
                <td>${escapeHtml(record.name)}</td>
                <td class="mono">${escapeHtml(record.id || "未记录")}</td>
                <td>${renderConditionTag(record)}</td>
                <td>${escapeHtml(inGroupLabel(record))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function conditionSortValue(record) {
  const className = conditionTagClass(record);
  const order = {
    "tag-condition-success": 1,
    "tag-condition-info": 2,
    "tag-condition-warn": 3,
    "tag-condition-danger": 4,
    "tag-condition-muted": 5,
  };
  return order[className] || 99;
}

function conditionGroupLabel(record) {
  if (normalize(record.role).includes("车身") && !record.id && record.condition) {
    return "特殊情况";
  }

  return conditionLabel(record);
}

function renderConditionGroupTag(group) {
  if (group.key === "特殊情况") {
    return '<span class="tag tag-condition-warn">特殊情况</span>';
  }

  return renderConditionTag(group.records[0]);
}

function renderConditionGroups(records) {
  const groups = groupBy(records, conditionGroupLabel)
    .sort((a, b) => {
      if (a.key === "特殊情况" && b.key !== "特殊情况") return 1;
      if (b.key === "特殊情况" && a.key !== "特殊情况") return -1;
      const aValue = conditionSortValue(a.records[0]);
      const bValue = conditionSortValue(b.records[0]);
      if (aValue !== bValue) return aValue - bValue;
      return a.key.localeCompare(b.key, "zh-CN");
    });

  return groups
    .map((group) => `
      <details class="condition-accordion">
        <summary>
          ${renderConditionGroupTag(group)}
          <span>${escapeHtml(group.records.length)} 人</span>
        </summary>
        ${renderRecordTable(group.records)}
      </details>
    `)
    .join("");
}

function renderRoleBody(role, records) {
  if (normalize(role).includes("车身")) {
    return renderConditionGroups(records);
  }

  return renderRecordTable(records);
}

function renderGroupedResults(records) {
  if (!records.length) {
    return '<div class="empty-state">没有匹配记录。</div>';
  }

  const openAttr = state.query || state.role !== "all" ? " open" : "";

  return groupBy(records, (record) => record.role)
    .map(
      (group) => `
        <details class="role-accordion"${openAttr}>
          <summary>
            <span class="tag tag-role">${escapeHtml(group.key)}</span>
            <strong>${escapeHtml(group.records.length)} 人</strong>
          </summary>
          ${renderRoleBody(group.key, group.records)}
        </details>
      `,
    )
    .join("");
}

function renderStatus() {
  els.statusLine.textContent = state.warnings.length
    ? `发现 ${state.warnings.length} 行格式提示`
    : "";
}

function render() {
  const filteredRecords = getFilteredRecords();
  renderStats(filteredRecords);
  renderFilters();
  els.resultTable.innerHTML = renderGroupedResults(filteredRecords);
  els.resultList.innerHTML = "";

  els.resultTitle.textContent = state.role === "all" ? "全部到位情况" : `${state.role} 到位情况`;
  els.resultMeta.textContent = `${filteredRecords.length} / ${state.records.length}`;
  renderStatus();
}

async function loadData() {
  try {
    const response = await fetch(`${CONFIG.dataFile}?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const parsed = parseSkyData(text);
    state.records = parsed.records;
    state.warnings = parsed.warnings;
    els.sourceStatus.textContent = "";
    els.sourceStatus.classList.add("is-hidden");
    render();
  } catch (error) {
    els.sourceStatus.textContent = "载入失败";
    els.sourceStatus.classList.remove("is-hidden");
    const localHint = window.location.protocol === "file:"
      ? "当前是直接打开本地 HTML，浏览器会阻止读取 txt。请在 blacklist-site 目录运行 python -m http.server 8010，然后访问 http://127.0.0.1:8010/sky.html。"
      : `请确认 ${CONFIG.dataFile} 与页面在同一目录。`;
    els.resultTable.innerHTML = `
      <div class="error-state">
        无法读取 ${CONFIG.dataFile}。${escapeHtml(localHint)}
      </div>
    `;
    els.resultList.innerHTML = "";
    els.statusLine.textContent = String(error.message || error);
  }
}

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

els.clearButton.addEventListener("click", () => {
  state.query = "";
  els.searchInput.value = "";
  els.searchInput.focus();
  render();
});

els.filterRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  state.role = button.dataset.role;
  render();
});

loadData();
