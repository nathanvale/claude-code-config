const variants = [
	{ key: "A", name: "Portfolio" },
	{ key: "B", name: "Runway" },
	{ key: "C", name: "Intervention desk" },
];

const state = {
	data: null,
	error: null,
	search: "",
	selectedSkill: null,
};

const app = document.querySelector("#app");

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");
}

function truncate(value, length = 72) {
	const text = String(value ?? "");
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function compactNumber(value) {
	return new Intl.NumberFormat("en-AU", { notation: "compact" }).format(value);
}

function formatDate(value, withTime = false) {
	if (!value) return "Not recorded";
	return new Intl.DateTimeFormat("en-AU", {
		day: "numeric",
		month: "short",
		...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
	}).format(new Date(value));
}

function timeAgo(value) {
	const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function icon(name, size = 18) {
	const paths = {
		arrowUpRight:
			'<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
		barChart:
			'<path d="M3 3v18h18"/><path d="M8 17V9"/><path d="M13 17V5"/><path d="M18 17v-3"/>',
		bolt: '<path d="m13 2-9 11h7l-1 9 9-12h-7l1-8Z"/>',
		check: '<path d="m5 12 4 4L19 6"/>',
		chevronLeft: '<path d="m15 18-6-6 6-6"/>',
		chevronRight: '<path d="m9 18 6-6-6-6"/>',
		filter:
			'<path d="M4 4h16l-6 7v5l-4 2v-7L4 4Z"/>',
		inbox:
			'<path d="M4 4h16v16H4z"/><path d="M4 14h4l2 3h4l2-3h4"/>',
		layers:
			'<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
		refresh:
			'<path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/>',
		search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
		sparkles:
			'<path d="m12 3-1.7 4.3L6 9l4.3 1.7L12 15l1.7-4.3L18 9l-4.3-1.7L12 3Z"/><path d="m5 16-.8 2.2L2 19l2.2.8L5 22l.8-2.2L8 19l-2.2-.8L5 16Z"/>',
		target:
			'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3"/>',
	};
	return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.sparkles}</svg>`;
}

function getData() {
	const usageEnvelope = state.data.usage;
	const queueEnvelope = state.data.queue;
	const reportsEnvelope = state.data.reports;
	const healthEnvelope = state.data.health;
	return {
		usage: usageEnvelope.data.skills,
		usageCounts: usageEnvelope.data.counts,
		queue: queueEnvelope.data.rows,
		queueCounts: queueEnvelope.data.counts,
		reports: reportsEnvelope.data.reports,
		reportCounts: reportsEnvelope.data.counts,
		health: healthEnvelope.data,
	};
}

function calculateMetrics(data) {
	const outcomes = data.usage.reduce(
		(result, skill) => ({
			confirmed: result.confirmed + skill.outcomes.confirmed,
			ambiguous: result.ambiguous + skill.outcomes.ambiguous,
			failed: result.failed + skill.outcomes.failed,
		}),
		{ confirmed: 0, ambiguous: 0, failed: 0 },
	);
	const outcomeTotal = outcomes.confirmed + outcomes.ambiguous + outcomes.failed;
	const confirmationRate = outcomeTotal
		? Math.round((outcomes.confirmed / outcomeTotal) * 100)
		: 0;
	const frictionRuns = data.usage
		.filter((skill) => skill.common_friction !== "none")
		.reduce((total, skill) => total + skill.primary_count, 0);
	return { outcomes, outcomeTotal, confirmationRate, frictionRuns };
}

function filteredData(data) {
	const query = (state.selectedSkill ?? state.search).toLowerCase().trim();
	const match = (...values) =>
		!query ||
		values.some((value) => String(value ?? "").toLowerCase().includes(query));
	return {
		...data,
		usage: data.usage.filter((skill) => match(skill.skill)),
		queue: data.queue.filter(
			(row) =>
				row.evidence_strength !== "weak" &&
				match(row.skill, row.target, row.reason),
		),
		reports: data.reports.filter((report) =>
			match(report.skill, report.goal, report.outcome),
		),
	};
}

function skillBadge(skill) {
	return `<button class="skill-chip" data-skill="${escapeHtml(skill)}">${escapeHtml(skill)}</button>`;
}

function outcomeBadge(outcome) {
	return `<span class="badge badge-${escapeHtml(outcome)}">${escapeHtml(outcome)}</span>`;
}

function evidenceBadge(strength) {
	return `<span class="evidence evidence-${escapeHtml(strength)}"><span></span>${escapeHtml(strength)}</span>`;
}

function sourceLabel(source) {
	return source === "driver_closeout" ? "Driver closeout" : "Hook capture";
}

function shellHeader(eyebrow, title, description) {
	return `
		<header class="page-header">
			<div>
				<p class="eyebrow">${eyebrow}</p>
				<h1>${title}</h1>
				<p class="page-description">${description}</p>
			</div>
			<div class="header-actions">
				<label class="search-box">
					${icon("search", 17)}
					<input aria-label="Filter dashboard" placeholder="Filter skills…" value="${escapeHtml(state.search)}" />
				</label>
				<button class="icon-button" data-action="refresh" aria-label="Refresh dashboard">${icon("refresh")}</button>
			</div>
		</header>
	`;
}

function filterContext() {
	if (!state.selectedSkill) return "";
	return `
		<div class="active-filter">
			<span>Filtered to <strong>${escapeHtml(state.selectedSkill)}</strong></span>
			<button data-action="clear-filter">Clear</button>
		</div>
	`;
}

function renderSwitcher(variant) {
	const currentIndex = variants.findIndex((item) => item.key === variant);
	return `
		<nav class="prototype-switcher" aria-label="Prototype variants">
			<button data-variant="${variants[(currentIndex - 1 + variants.length) % variants.length].key}" aria-label="Previous variant">${icon("chevronLeft")}</button>
			<div>
				<span>Prototype</span>
				<strong>${variant} · ${variants[currentIndex].name}</strong>
			</div>
			<button data-variant="${variants[(currentIndex + 1) % variants.length].key}" aria-label="Next variant">${icon("chevronRight")}</button>
		</nav>
	`;
}

function metricCard(label, value, detail, tone, iconName) {
	return `
		<article class="metric-card metric-${tone}">
			<div class="metric-icon">${icon(iconName)}</div>
			<p>${label}</p>
			<strong>${value}</strong>
			<span>${detail}</span>
		</article>
	`;
}

function performanceBar(skill) {
	const total = Math.max(skill.primary_count, 1);
	const confirmed = Math.round((skill.outcomes.confirmed / total) * 100);
	const ambiguous = Math.round((skill.outcomes.ambiguous / total) * 100);
	return `
		<div class="outcome-bar" title="${confirmed}% confirmed, ${ambiguous}% ambiguous">
			<span class="bar-confirmed" style="width:${confirmed}%"></span>
			<span class="bar-ambiguous" style="width:${ambiguous}%"></span>
		</div>
	`;
}

function renderPortfolio(data) {
	const metrics = calculateMetrics(data);
	const visible = filteredData(data);
	return `
		<div class="variant variant-a">
			<aside class="side-rail">
				<div class="brand-lockup">
					<div class="brand-mark">SF</div>
					<div><strong>Skill Feedback</strong><span>Evidence workspace</span></div>
				</div>
				<nav class="side-nav">
					<a class="active" href="#portfolio">${icon("barChart")} Portfolio</a>
					<a href="#skills">${icon("layers")} Skill register <span>${data.usage.length}</span></a>
					<a href="#improvements">${icon("target")} Improvements <span>${data.queueCounts.returned_count}</span></a>
					<a href="#activity">${icon("inbox")} Report inbox <span>${compactNumber(data.reportCounts.primary_count)}</span></a>
				</nav>
				<div class="rail-note">
					${icon("sparkles")}
					<strong>Evidence, not verdicts</strong>
					<p>Observed outcomes stay untrusted until confirmed against owner source.</p>
				</div>
			</aside>
			<main class="portfolio-main">
				${shellHeader("Portfolio overview", "How are the skills doing?", "Usage, outcomes, friction, and evidence-backed improvement signals.")}
				${filterContext()}
				<section class="metric-grid">
					${metricCard("Primary reports", compactNumber(data.reportCounts.primary_count), `${compactNumber(data.reportCounts.low_signal_count)} low-signal separated`, "ink", "inbox")}
					${metricCard("Observed confirmed", `${metrics.confirmationRate}%`, `${metrics.outcomes.ambiguous} ambiguous outcomes`, "lime", "check")}
					${metricCard("Skills observed", data.usage.length, `${data.usage.filter((skill) => skill.primary_count >= 10).length} with 10+ reports`, "blue", "layers")}
					${metricCard("Strong candidates", data.queue.filter((row) => row.evidence_strength === "strong").length, `${data.queueCounts.weak_available_count} weak candidates hidden`, "coral", "target")}
				</section>
				<section class="portfolio-columns">
					<article class="panel skill-table-panel" id="skills">
						<div class="panel-heading">
							<div><p class="eyebrow">Skill register</p><h2>Observed performance</h2></div>
							<span>${visible.usage.length} skills</span>
						</div>
						<div class="skill-table">
							<div class="skill-table-head"><span>Skill</span><span>Outcomes</span><span>Friction</span><span>Burden</span><span>Last seen</span></div>
							${visible.usage
								.slice(0, 14)
								.map(
									(skill) => `
										<button class="skill-row" data-skill="${escapeHtml(skill.skill)}">
											<span class="skill-name"><b>${escapeHtml(skill.skill)}</b><small>${skill.primary_count} reports</small></span>
											<span>${performanceBar(skill)}<small>${skill.outcomes.confirmed} confirmed · ${skill.outcomes.ambiguous} ambiguous</small></span>
											<span class="cell-tag">${escapeHtml(skill.common_friction.replaceAll("_", " "))}</span>
											<span class="burden burden-${escapeHtml(skill.common_verification_burden)}">${escapeHtml(skill.common_verification_burden)}</span>
											<span class="last-seen">${timeAgo(skill.last_seen_generated_ts)}${icon("chevronRight", 16)}</span>
										</button>
								`,
								)
								.join("")}
						</div>
					</article>
					<aside class="panel queue-panel" id="improvements">
						<div class="panel-heading">
							<div><p class="eyebrow">Improvement queue</p><h2>Inspect next</h2></div>
							${icon("arrowUpRight")}
						</div>
						<div class="queue-stack">
							${visible.queue
								.slice(0, 6)
								.map(
									(row, index) => `
										<button class="queue-card" data-skill="${escapeHtml(row.skill)}">
											<span class="queue-number">${String(index + 1).padStart(2, "0")}</span>
											<div>
												${evidenceBadge(row.evidence_strength)}
												<strong>${escapeHtml(truncate(row.target, 47))}</strong>
												<p>${escapeHtml(row.reason)}</p>
												<small>${escapeHtml(row.skill)} · ${row.report_refs.length} ${row.report_refs.length === 1 ? "report" : "reports"}</small>
											</div>
										</button>
								`,
								)
								.join("")}
						</div>
					</aside>
				</section>
			</main>
		</div>
	`;
}

function dailyActivity(reports) {
	const buckets = new Map();
	for (let offset = 6; offset >= 0; offset -= 1) {
		const date = new Date();
		date.setHours(0, 0, 0, 0);
		date.setDate(date.getDate() - offset);
		buckets.set(date.toISOString().slice(0, 10), {
			label: new Intl.DateTimeFormat("en-AU", { weekday: "short" }).format(date),
			count: 0,
			confirmed: 0,
		});
	}
	for (const report of reports) {
		const bucket = buckets.get(report.generated_ts.slice(0, 10));
		if (!bucket) continue;
		bucket.count += 1;
		if (report.outcome === "confirmed") bucket.confirmed += 1;
	}
	return [...buckets.values()];
}

function renderRunway(data) {
	const visible = filteredData(data);
	const metrics = calculateMetrics(data);
	const activity = dailyActivity(data.reports);
	const max = Math.max(...activity.map((day) => day.count), 1);
	const noisySkills = [...visible.usage]
		.sort(
			(a, b) =>
				b.outcomes.ambiguous / Math.max(b.primary_count, 1) -
				a.outcomes.ambiguous / Math.max(a.primary_count, 1),
		)
		.slice(0, 5);
	return `
		<div class="variant variant-b">
			<header class="runway-nav">
				<div class="brand-lockup inverse">
					<div class="brand-mark">SF</div>
					<div><strong>Skill Feedback</strong><span>Live evidence runway</span></div>
				</div>
				<div class="runway-nav-links"><span class="active">Pulse</span><span>Skills</span><span>Signals</span></div>
				<div class="freshness"><span></span> Updated ${timeAgo(state.data.generatedAt)}</div>
			</header>
			<main class="runway-main">
				${shellHeader("Evidence pulse", "The last 100 reports, in motion.", "Follow activity first. Open a skill when its outcome mix or verification burden changes.")}
				${filterContext()}
				<section class="runway-summary">
					<div class="runway-lead">
						<p>Observed confirmed outcome</p>
						<div><strong>${metrics.confirmationRate}</strong><span>%</span></div>
						<small>Across ${metrics.outcomeTotal} primary observations</small>
					</div>
					<div class="activity-chart">
						<div class="chart-heading">
							<div><p>Report activity</p><strong>Last 7 days</strong></div>
							<div class="chart-legend"><span class="legend-confirmed"></span> Confirmed <span class="legend-other"></span> Other</div>
						</div>
						<div class="bars">
							${activity
								.map(
									(day) => `
										<div class="bar-column">
											<div class="stacked-bar" style="height:${Math.max(8, Math.round((day.count / max) * 160))}px">
												<span class="stack-other" style="height:${day.count ? ((day.count - day.confirmed) / day.count) * 100 : 0}%"></span>
											</div>
											<strong>${day.count}</strong>
											<small>${day.label}</small>
										</div>
								`,
								)
								.join("")}
						</div>
					</div>
					<div class="runway-stat-stack">
						<div><span>Primary</span><strong>${data.reportCounts.primary_count}</strong></div>
						<div><span>Low signal</span><strong>${data.reportCounts.low_signal_count}</strong></div>
						<div><span>Queue</span><strong>${data.queueCounts.returned_count}</strong></div>
					</div>
				</section>
				<section class="runway-grid">
					<article class="activity-feed">
						<div class="section-title"><div><p class="eyebrow">Latest evidence</p><h2>Run stream</h2></div><span>${visible.reports.length} visible</span></div>
						<div class="timeline">
							${visible.reports
								.slice(0, 12)
								.map(
									(report) => `
										<button class="timeline-row" data-report="${escapeHtml(report.report_ref)}">
											<time>${formatDate(report.generated_ts, true)}</time>
											<span class="timeline-node node-${escapeHtml(report.outcome)}"></span>
											<div>
												<div>${skillBadge(report.skill)} ${outcomeBadge(report.outcome)}</div>
												<strong>${escapeHtml(truncate(report.goal, 94))}</strong>
												<small>${sourceLabel(report.source)} · ${escapeHtml(report.report_ref)}</small>
											</div>
											${icon("arrowUpRight")}
										</button>
								`,
								)
								.join("")}
						</div>
					</article>
					<aside class="signal-column">
						<div class="signal-panel">
							<div class="section-title"><div><p class="eyebrow">Outcome watch</p><h2>Ambiguity pulse</h2></div>${icon("bolt")}</div>
							${noisySkills
								.map((skill) => {
									const rate = Math.round(
										(skill.outcomes.ambiguous /
											Math.max(skill.primary_count, 1)) *
											100,
									);
									return `
										<button class="pulse-row" data-skill="${escapeHtml(skill.skill)}">
											<div><strong>${escapeHtml(skill.skill)}</strong><small>${skill.outcomes.ambiguous} ambiguous of ${skill.primary_count}</small></div>
											<div class="pulse-meter"><span style="width:${rate}%"></span></div>
											<b>${rate}%</b>
										</button>
									`;
								})
								.join("")}
						</div>
						<div class="signal-panel recent-skills">
							<div class="section-title"><div><p class="eyebrow">Freshness</p><h2>Recently active</h2></div></div>
							${[...visible.usage]
								.sort(
									(a, b) =>
										new Date(b.last_seen_generated_ts) -
										new Date(a.last_seen_generated_ts),
								)
								.slice(0, 7)
								.map(
									(skill) => `
										<button data-skill="${escapeHtml(skill.skill)}"><span>${escapeHtml(skill.skill)}</span><small>${timeAgo(skill.last_seen_generated_ts)}</small></button>
								`,
								)
								.join("")}
						</div>
					</aside>
				</section>
			</main>
		</div>
	`;
}

function renderDesk(data) {
	const visible = filteredData(data);
	const highBurden = visible.usage
		.filter((skill) =>
			["heavy", "moderate"].includes(skill.common_verification_burden),
		)
		.sort(
			(a, b) =>
				(b.common_verification_burden === "heavy" ? 1 : 0) -
					(a.common_verification_burden === "heavy" ? 1 : 0) ||
				b.primary_count - a.primary_count,
		);
	const ambiguous = visible.reports.filter(
		(report) => report.outcome === "ambiguous",
	);
	return `
		<div class="variant variant-c">
			<header class="desk-toolbar">
				<div class="brand-lockup compact">
					<div class="brand-mark">SF</div>
					<div><strong>Intervention desk</strong><span>Skill Feedback · local</span></div>
				</div>
				<div class="desk-status">
					<span><i></i>${data.reportCounts.primary_count} primary</span>
					<span>${data.queueCounts.weak_available_count} weak candidates</span>
					<span>Updated ${timeAgo(state.data.generatedAt)}</span>
				</div>
				<div class="toolbar-actions">
					<label class="search-box dark">
						${icon("search", 17)}
						<input aria-label="Filter dashboard" placeholder="Search…" value="${escapeHtml(state.search)}" />
					</label>
					<button class="icon-button dark" data-action="refresh" aria-label="Refresh dashboard">${icon("refresh")}</button>
				</div>
			</header>
			<main class="desk-main">
				<section class="desk-heading">
					<div><p class="eyebrow">Decision surface</p><h1>What deserves attention?</h1></div>
					<div class="desk-controls">
						<span class="active">Strong evidence</span>
						<span>${data.queueCounts.weak_available_count} weak hidden</span>
					</div>
				</section>
				${filterContext()}
				<section class="desk-layout">
					<article class="desk-queue">
						<div class="desk-column-heading">
							<div><span class="column-index">01</span><div><p>Improvement queue</p><strong>Evidence-backed inspection candidates</strong></div></div>
							<span>${visible.queue.length} rows</span>
						</div>
						<div class="desk-table">
							<div class="desk-table-head"><span>Evidence</span><span>Target / reason</span><span>Skill</span><span>Reports</span><span></span></div>
							${visible.queue
								.slice(0, 18)
								.map(
									(row) => `
										<button class="desk-queue-row" data-skill="${escapeHtml(row.skill)}">
											${evidenceBadge(row.evidence_strength)}
											<span class="desk-target"><strong>${escapeHtml(truncate(row.target, 60))}</strong><small>${escapeHtml(row.reason)}</small></span>
											<span>${escapeHtml(row.skill)}</span>
											<span class="report-count">${row.report_refs.length}</span>
											${icon("chevronRight", 16)}
										</button>
								`,
								)
								.join("")}
						</div>
					</article>
					<aside class="desk-sidebar">
						<div class="desk-column-heading">
							<div><span class="column-index">02</span><div><p>Verification load</p><strong>Skills carrying proof tax</strong></div></div>
						</div>
						<div class="burden-stack">
							${highBurden
								.slice(0, 9)
								.map(
									(skill) => `
										<button data-skill="${escapeHtml(skill.skill)}">
											<span class="burden burden-${escapeHtml(skill.common_verification_burden)}">${escapeHtml(skill.common_verification_burden)}</span>
											<strong>${escapeHtml(skill.skill)}</strong>
											<small>${skill.primary_count} reports · ${escapeHtml(skill.common_friction.replaceAll("_", " "))}</small>
											${performanceBar(skill)}
										</button>
								`,
								)
								.join("")}
						</div>
						<div class="ambiguity-box">
							<div class="desk-column-heading">
								<div><span class="column-index">03</span><div><p>Evidence gaps</p><strong>Recent ambiguous runs</strong></div></div>
							</div>
							${ambiguous
								.slice(0, 5)
								.map(
									(report) => `
										<button data-report="${escapeHtml(report.report_ref)}">
											<div>${escapeHtml(report.skill)}<span>${formatDate(report.generated_ts)}</span></div>
											<p>${escapeHtml(truncate(report.goal, 68))}</p>
										</button>
								`,
								)
								.join("") ||
							'<p class="empty-copy">No ambiguous runs in this filtered view.</p>'}
						</div>
					</aside>
				</section>
			</main>
		</div>
	`;
}

function renderReportDrawer(payload) {
	const report = payload?.data;
	if (!report) return;
	const existing = document.querySelector(".report-drawer");
	existing?.remove();
	const drawer = document.createElement("aside");
	drawer.className = "report-drawer";
	drawer.innerHTML = `
		<div class="drawer-heading">
			<div><p class="eyebrow">Software Learning Report</p><h2>${escapeHtml(report.skill)}</h2></div>
			<button data-action="close-drawer" aria-label="Close report">×</button>
		</div>
		<div class="drawer-badges">${outcomeBadge(report.outcome)} <span class="badge">${escapeHtml(report.lane)}</span> <span class="badge">${escapeHtml(sourceLabel(report.source))}</span></div>
		<section><span>Goal</span><p>${escapeHtml(report.goal ?? "Not recorded")}</p></section>
		<section><span>Friction</span><p>${escapeHtml(report.friction?.note ?? report.friction ?? "Not recorded")}</p></section>
		<section><span>Verification burden</span><p>${escapeHtml(report.verification_burden?.level ?? report.verification_burden ?? "Not recorded")}</p></section>
		<section><span>Report ref</span><code>${escapeHtml(report.report_ref)}</code></section>
		<p class="drawer-caveat">Treat this report as evidence. Confirm against owner source before changing a skill.</p>
	`;
	document.body.append(drawer);
	requestAnimationFrame(() => drawer.classList.add("open"));
	drawer.querySelector('[data-action="close-drawer"]').addEventListener("click", () => drawer.remove());
}

async function openReport(reportRef) {
	try {
		const response = await fetch(`/api/report?ref=${encodeURIComponent(reportRef)}`);
		renderReportDrawer(await response.json());
	} catch {
		// Throwaway prototype: a failed drawer read leaves the dashboard intact.
	}
}

function currentVariant() {
	const value = new URLSearchParams(window.location.search).get("variant") ?? "A";
	return variants.some((variant) => variant.key === value) ? value : "A";
}

function render() {
	if (state.error) {
		app.innerHTML = `<div class="error-state"><strong>Dashboard read failed</strong><p>${escapeHtml(state.error)}</p><button data-action="refresh">Try again</button></div>`;
		return;
	}
	if (!state.data) return;

	const data = getData();
	const variant = currentVariant();
	app.innerHTML =
		(variant === "A"
			? renderPortfolio(data)
			: variant === "B"
				? renderRunway(data)
				: renderDesk(data)) + renderSwitcher(variant);
	bindEvents();
}

function setVariant(key) {
	const url = new URL(window.location.href);
	url.searchParams.set("variant", key);
	window.history.replaceState({}, "", url);
	render();
}

async function loadData() {
	state.error = null;
	try {
		const response = await fetch("/api/dashboard");
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error ?? "Unknown read failure");
		state.data = payload;
		render();
	} catch (error) {
		state.error = error instanceof Error ? error.message : "Unknown read failure";
		render();
	}
}

function bindEvents() {
	for (const button of document.querySelectorAll("[data-variant]")) {
		button.addEventListener("click", () => setVariant(button.dataset.variant));
	}
	for (const input of document.querySelectorAll(".search-box input")) {
		input.addEventListener("input", (event) => {
			state.search = event.target.value;
			state.selectedSkill = null;
			render();
			const next = document.querySelector(".search-box input");
			next?.focus();
			next?.setSelectionRange(state.search.length, state.search.length);
		});
	}
	for (const button of document.querySelectorAll("[data-skill]")) {
		button.addEventListener("click", (event) => {
			event.stopPropagation();
			state.selectedSkill = button.dataset.skill;
			state.search = "";
			render();
		});
	}
	for (const button of document.querySelectorAll("[data-report]")) {
		button.addEventListener("click", () => openReport(button.dataset.report));
	}
	document
		.querySelector('[data-action="refresh"]')
		?.addEventListener("click", loadData);
	document
		.querySelector('[data-action="clear-filter"]')
		?.addEventListener("click", () => {
			state.selectedSkill = null;
			render();
		});
}

window.addEventListener("keydown", (event) => {
	if (
		event.target instanceof HTMLInputElement ||
		event.target instanceof HTMLTextAreaElement ||
		event.target?.isContentEditable
	) {
		return;
	}
	if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
	const index = variants.findIndex((variant) => variant.key === currentVariant());
	const direction = event.key === "ArrowRight" ? 1 : -1;
	setVariant(variants[(index + direction + variants.length) % variants.length].key);
});

window.addEventListener("popstate", render);
loadData();
