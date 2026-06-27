const CONFIG = {
  alliancesFile: "alliances.txt",
  membersFile: "members.txt",
  commentPrefixes: ["#", "//"],
  idPattern: /\b\d{6,15}\b/,
};

const state = {
  alliances: [],
  members: [],
  warnings: [],
  query: "",
  selectedAlliance: "all",
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

function splitFields(line) {
  return line
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseAllianceCodeAndName(line) {
  const match = line.match(/^\[([^\]]+)]\s*(.+)$/);
  if (!match) return null;

  return {
    code: match[1].trim(),
    name: match[2].trim(),
  };
}

function parseAlliances(text) {
  const alliances = [];
  const warnings = [];
  const seen = new Set();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = normalizeLine(rawLine);
    if (!line || isComment(line)) return;

    const parsed = parseAllianceCodeAndName(line);
    if (!parsed) {
      warnings.push(`alliances.txt 第 ${lineNo} 行未识别：${line}`);
      return;
    }

    const key = normalize(parsed.code);
    if (seen.has(key)) {
      warnings.push(`alliances.txt 第 ${lineNo} 行重复联盟代号：${parsed.code}`);
      return;
    }

    seen.add(key);
    alliances.push({
      ...parsed,
      key,
      lineNo,
    });
  });

  return { alliances, warnings };
}

function parseMemberLine(line, rawLine, lineNo, allianceByKey) {
  const parsedAlliance = parseAllianceCodeAndName(line);
  if (!parsedAlliance) return null;

  const allianceKey = normalize(parsedAlliance.code);
  const canonicalAlliance = allianceByKey.get(allianceKey);
  const parts = splitFields(parsedAlliance.name);
  const idIndex = parts.findIndex((part) => CONFIG.idPattern.test(part));
  if (idIndex < 0) return null;

  const id = parts[idIndex].match(CONFIG.idPattern)[0];
  const currentName = parts.slice(0, idIndex).join("，").trim();
  const formerName = parts.slice(idIndex + 1).join("，").trim();

  return {
    allianceCode: canonicalAlliance?.code || parsedAlliance.code,
    allianceKey,
    id,
    currentName,
    formerName,
    lineNo,
    raw: rawLine,
  };
}

function parseMembers(text, alliances) {
  const members = [];
  const warnings = [];
  const allianceByKey = new Map(alliances.map((alliance) => [alliance.key, alliance]));
  const idCounts = new Map();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = normalizeLine(rawLine);
    if (!line || isComment(line)) return;

    const member = parseMemberLine(line, rawLine, lineNo, allianceByKey);
    if (!member) {
      warnings.push(`members.txt 第 ${lineNo} 行未识别为成员：${line}`);
      return;
    }

    if (!member.currentName) {
      warnings.push(`members.txt 第 ${lineNo} 行缺少当前名：${line}`);
    }

    if (!allianceByKey.has(member.allianceKey)) {
      warnings.push(`members.txt 第 ${lineNo} 行联盟未登记：${member.allianceCode}`);
    }

    members.push(member);
    idCounts.set(member.id, (idCounts.get(member.id) || 0) + 1);
  });

  for (const [id, count] of idCounts.entries()) {
    if (count > 1) {
      warnings.push(`members.txt 存在重复 ID：${id}，共 ${count} 条`);
    }
  }

  return { members, warnings };
}

function buildAllianceViews() {
  const memberGroups = new Map();

  state.members.forEach((member) => {
    if (!memberGroups.has(member.allianceKey)) memberGroups.set(member.allianceKey, []);
    memberGroups.get(member.allianceKey).push(member);
  });

  const registered = state.alliances.map((alliance) => ({
    ...alliance,
    members: memberGroups.get(alliance.key) || [],
  }));

  const registeredKeys = new Set(state.alliances.map((alliance) => alliance.key));
  const unregistered = [...memberGroups.entries()]
    .filter(([key]) => !registeredKeys.has(key))
    .map(([key, members]) => ({
      code: members[0]?.allianceCode || key,
      name: "未登记联盟",
      key,
      lineNo: null,
      members,
    }));

  return [...registered, ...unregistered];
}

function getFilteredAllianceViews() {
  const terms = String(state.query || "")
    .trim()
    .split(/\s+/)
    .map(normalize)
    .filter(Boolean);

  return buildAllianceViews()
    .map((alliance) => {
      const matchedMembers = terms.length
        ? alliance.members.filter((member) => {
            const memberText = normalize([
              member.id,
              member.currentName,
              member.formerName,
              member.allianceCode,
            ].join(" "));
            return terms.every((term) => memberText.includes(term));
          })
        : alliance.members;

      return {
        ...alliance,
        matchedMembers,
      };
    })
    .filter((alliance) => {
      if (
        state.selectedAlliance !== "all" &&
        alliance.key !== state.selectedAlliance
      ) {
        return false;
      }

      if (!terms.length) return true;

      const allianceText = normalize([alliance.code, alliance.name].join(" "));
      const allianceMatched = terms.every((term) => allianceText.includes(term));
      return allianceMatched || alliance.matchedMembers.length > 0;
    });
}

function renderStats(filteredAlliances) {
  const filledAlliances = buildAllianceViews().filter((alliance) => alliance.members.length > 0);

  els.statsGrid.innerHTML = [
    ["联盟数", state.alliances.length],
    ["已填成员联盟", filledAlliances.length],
    ["成员总数", state.members.length],
    ["当前命中", filteredAlliances.length],
  ]
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
  const buttons = [
    { key: "all", code: "全部", name: "", count: state.alliances.length },
    ...buildAllianceViews().map((alliance) => ({
      key: alliance.key,
      code: alliance.code,
      name: alliance.name,
      count: alliance.members.length,
    })),
  ];

  els.filterRow.innerHTML = buttons
    .map(
      (item) => `
        <button
          class="filter-button ${state.selectedAlliance === item.key ? "active" : ""}"
          type="button"
          data-alliance="${escapeHtml(item.key)}"
          title="${escapeHtml(item.name || item.code)}"
        >
          ${escapeHtml(item.code)} ${escapeHtml(item.count)}
        </button>
      `,
    )
    .join("");
}

function renderAllianceCards(alliances) {
  if (!alliances.length) {
    return '<div class="empty-state">没有匹配联盟。</div>';
  }

  return `
    <div class="alliance-grid">
      ${alliances
        .map((alliance) => {
          const memberPreview = alliance.matchedMembers
            .slice(0, 4)
            .map((member) => `${member.currentName || "未知"} / ${member.id}`)
            .join("；");
          const remaining = alliance.matchedMembers.length > 4
            ? `，另 ${alliance.matchedMembers.length - 4} 条`
            : "";

          return `
            <article class="alliance-card">
              <div class="alliance-card-head">
                <span class="alliance-code">[${escapeHtml(alliance.code)}]</span>
                <span class="tag tag-alliance">${escapeHtml(alliance.members.length)} 人</span>
              </div>
              <h3>${escapeHtml(alliance.name)}</h3>
              <p>${memberPreview ? `命中成员：${escapeHtml(memberPreview + remaining)}` : "成员信息待维护"}</p>
              <button
                class="copy-button"
                type="button"
                data-alliance-select="${escapeHtml(alliance.key)}"
              >
                查看此联盟
              </button>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderMemberRows(members) {
  if (!members.length) {
    return '<div class="empty-state">此联盟暂无成员记录。</div>';
  }

  return `
    <div class="member-detail">
      <table>
        <thead>
          <tr>
            <th>昵称</th>
            <th>ID</th>
            <th>曾用名</th>
          </tr>
        </thead>
        <tbody>
          ${members
            .map(
              (member) => `
                <tr>
                  <td>${escapeHtml(member.currentName || "未知")}</td>
                  <td class="mono">${escapeHtml(member.id)}</td>
                  <td>${escapeHtml(member.formerName || "无")}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderMemberCards(members) {
  if (!members.length) {
    return '<div class="empty-state">此联盟暂无成员记录。</div>';
  }

  return `
    <div class="member-card-list">
      ${members
        .map(
          (member) => `
            <article class="record-card">
              <div class="record-top">
                <strong>${escapeHtml(member.currentName || "未知")}</strong>
                <span class="mono">${escapeHtml(member.id)}</span>
              </div>
              <div class="record-grid compact-record-grid">
                <span>曾用名</span><strong>${escapeHtml(member.formerName || "无")}</strong>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderAllianceDetail(alliance) {
  const header = `
    <section class="detail-panel">
      <div class="detail-panel-head">
        <div>
          <span class="alliance-code">[${escapeHtml(alliance.code)}]</span>
          <h3>${escapeHtml(alliance.name)}</h3>
        </div>
        <span class="tag tag-alliance">${escapeHtml(alliance.matchedMembers.length)} / ${escapeHtml(alliance.members.length)} 人</span>
      </div>
      <p>成员字段：昵称、ID、曾用名。</p>
    </section>
  `;

  return {
    tableHtml: header + renderMemberRows(alliance.matchedMembers),
    cardHtml: header + renderMemberCards(alliance.matchedMembers),
  };
}

function renderStatus() {
  els.statusLine.textContent = state.warnings.length
    ? `发现 ${state.warnings.length} 条数据格式提示`
    : "";
}

function render() {
  const filteredAlliances = getFilteredAllianceViews();
  renderStats(filteredAlliances);
  renderFilters();

  if (state.selectedAlliance === "all") {
    const cards = renderAllianceCards(filteredAlliances);
    els.resultTable.innerHTML = cards;
    els.resultList.innerHTML = cards;
    els.resultTitle.textContent = "联盟列表";
  } else {
    const alliance = filteredAlliances[0];
    if (alliance) {
      const detail = renderAllianceDetail(alliance);
      els.resultTable.innerHTML = detail.tableHtml;
      els.resultList.innerHTML = detail.cardHtml;
    } else {
      els.resultTable.innerHTML = '<div class="empty-state">没有匹配成员。</div>';
      els.resultList.innerHTML = '<div class="empty-state">没有匹配成员。</div>';
    }
    els.resultTitle.textContent = "联盟成员";
  }

  els.resultMeta.textContent = `${filteredAlliances.length} / ${state.alliances.length}`;
  renderStatus();
}

async function loadTextFile(path) {
  const response = await fetch(`${path}?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
  return response.text();
}

async function loadData() {
  try {
    const [alliancesText, membersText] = await Promise.all([
      loadTextFile(CONFIG.alliancesFile),
      loadTextFile(CONFIG.membersFile),
    ]);

    const parsedAlliances = parseAlliances(alliancesText);
    const parsedMembers = parseMembers(membersText, parsedAlliances.alliances);

    state.alliances = parsedAlliances.alliances;
    state.members = parsedMembers.members;
    state.warnings = [
      ...parsedAlliances.warnings,
      ...parsedMembers.warnings,
    ];

    els.sourceStatus.textContent = "";
    els.sourceStatus.classList.add("is-hidden");
    render();
  } catch (error) {
    els.sourceStatus.textContent = "载入失败";
    els.sourceStatus.classList.remove("is-hidden");
    const localHint = window.location.protocol === "file:"
      ? "当前是直接打开本地 HTML，浏览器会阻止读取 txt。请在 blacklist-site 目录运行 python -m http.server 8010，然后访问 http://127.0.0.1:8010/。"
      : `请确认 ${CONFIG.alliancesFile} 和 ${CONFIG.membersFile} 与页面在同一目录。`;
    els.resultTable.innerHTML = `
      <div class="error-state">
        无法读取联盟数据。${escapeHtml(localHint)}
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
  state.selectedAlliance = "all";
  els.searchInput.value = "";
  els.searchInput.focus();
  render();
});

els.filterRow.addEventListener("click", (event) => {
  const button = event.target.closest("[data-alliance]");
  if (!button) return;
  state.selectedAlliance = button.dataset.alliance;
  render();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-alliance-select]");
  if (!button) return;
  state.selectedAlliance = button.dataset.allianceSelect;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

loadData();
