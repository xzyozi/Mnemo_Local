import type { MonthlyTopicCount, Topic } from "./domain.js";

export const TOPIC_PALETTE = [
  "#4f46e5", // Indigo
  "#059669", // Emerald
  "#d97706", // Amber
  "#dc2626", // Red
  "#0284c7", // Sky
  "#7c3aed", // Violet
  "#db2777", // Pink
  "#65a30d", // Lime
];

const escapeXml = (unsafe: string): string =>
  unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const generateTopicTimelineSvg = (
  timeline: MonthlyTopicCount[],
  topics: Topic[],
  selectedTopicId: string | null = null,
): string => {
  const width = 800;
  const height = 360;
  const padding = { top: 30, right: 30, bottom: 80, left: 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  if (timeline.length === 0 || topics.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" class="topic-timeline-svg">
  <text x="${width / 2}" y="${height / 2}" text-anchor="middle" fill="#6b7280" font-size="14">データがありません</text>
</svg>`;
  }

  const maxTotal = Math.max(1, ...timeline.map((t) => t.total));
  const slotWidth = plotWidth / timeline.length;
  const barWidth = Math.min(48, Math.max(12, slotWidth * 0.65));

  const topicColorMap = new Map<string, string>();
  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    if (topic) {
      topicColorMap.set(topic.topicId, TOPIC_PALETTE[i % TOPIC_PALETTE.length] ?? "#4f46e5");
    }
  }

  // Y-axis grid lines (4 intervals)
  const gridSteps = 4;
  let gridLines = "";
  for (let i = 0; i <= gridSteps; i++) {
    const yVal = Math.round((maxTotal / gridSteps) * i);
    const yPos = padding.top + plotHeight - (plotHeight / gridSteps) * i;
    gridLines += `
  <line x1="${padding.left}" y1="${yPos}" x2="${width - padding.right}" y2="${yPos}" stroke="#e5e7eb" stroke-dasharray="3,3" />
  <text x="${padding.left - 8}" y="${yPos + 4}" text-anchor="end" fill="#9ca3af" font-size="11">${yVal}</text>`;
  }

  // Bars and X-axis labels
  let bars = "";
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    if (!item) continue;

    const centerX = padding.left + slotWidth * i + slotWidth / 2;
    const barX = centerX - barWidth / 2;

    // Stack segments
    let currentY = padding.top + plotHeight;
    for (const topic of topics) {
      const count = item.counts[topic.topicId] ?? 0;
      if (count === 0) continue;

      const segHeight = (count / maxTotal) * plotHeight;
      const segY = currentY - segHeight;
      const color = topicColorMap.get(topic.topicId) ?? "#4f46e5";
      const isSelected = selectedTopicId === null || selectedTopicId === topic.topicId;
      const opacity = isSelected ? "1" : "0.2";

      bars += `
  <rect x="${barX}" y="${segY}" width="${barWidth}" height="${segHeight}" fill="${color}" opacity="${opacity}" rx="2" data-topic-id="${escapeXml(topic.topicId)}" style="cursor: pointer; transition: opacity 0.2s;">
    <title>${escapeXml(topic.label)}: ${count}件 (${escapeXml(item.month)})</title>
  </rect>`;
      currentY = segY;
    }

    // Month label
    bars += `
  <text x="${centerX}" y="${padding.top + plotHeight + 20}" text-anchor="middle" fill="#4b5563" font-size="12">${escapeXml(item.month)}</text>`;
  }

  // Legend
  let legend = `<g transform="translate(${padding.left}, ${height - 35})">`;
  let currentLegendX = 0;
  for (const topic of topics) {
    const color = topicColorMap.get(topic.topicId) ?? "#4f46e5";
    const isSelected = selectedTopicId === null || selectedTopicId === topic.topicId;
    const opacity = isSelected ? "1" : "0.35";
    const label = escapeXml(topic.label);
    const itemWidth = Math.max(80, label.length * 13 + 30);

    legend += `
    <g class="legend-item" data-topic-id="${escapeXml(topic.topicId)}" opacity="${opacity}" style="cursor: pointer;" transform="translate(${currentLegendX}, 0)">
      <rect width="12" height="12" rx="2" fill="${color}" y="0" />
      <text x="18" y="10" fill="#374151" font-size="12">${label}</text>
    </g>`;
    currentLegendX += itemWidth;
  }
  legend += "</g>";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" class="topic-timeline-svg" style="user-select: none;">
  <style>
    .topic-timeline-svg rect:hover { filter: brightness(1.1); }
    .topic-timeline-svg .legend-item:hover { opacity: 0.8; }
  </style>
  ${gridLines}
  ${bars}
  ${legend}
</svg>`;
};

export const renderTopicTimelineSvg = (
  timeline: MonthlyTopicCount[],
  topics: Topic[],
  onSelectTopic?: (topicId: string | null) => void,
): SVGSVGElement => {
  let activeSelectedTopicId: string | null = null;

  const updateSvg = (svgElem: SVGSVGElement, selectedId: string | null) => {
    const rawSvg = generateTopicTimelineSvg(timeline, topics, selectedId);
    if (typeof DOMParser !== "undefined") {
      const parser = new DOMParser();
      const parsedDoc = parser.parseFromString(rawSvg, "image/svg+xml");
      const newSvg = parsedDoc.documentElement;
      svgElem.innerHTML = newSvg.innerHTML;
      for (const attr of Array.from(newSvg.attributes)) {
        svgElem.setAttribute(attr.name, attr.value);
      }
    } else {
      svgElem.innerHTML = rawSvg;
    }
  };

  let root: SVGSVGElement;
  if (typeof document !== "undefined") {
    root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    updateSvg(root, activeSelectedTopicId);

    root.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (!target) return;
      const topicEl = target.closest("[data-topic-id]");
      if (topicEl) {
        const topicId = topicEl.getAttribute("data-topic-id");
        activeSelectedTopicId = activeSelectedTopicId === topicId ? null : topicId;
        updateSvg(root, activeSelectedTopicId);
        onSelectTopic?.(activeSelectedTopicId);
      }
    });
  } else {
    // Fallback for non-browser environment
    root = {
      outerHTML: generateTopicTimelineSvg(timeline, topics, null),
      innerHTML: "",
      setAttribute: () => {},
      addEventListener: () => {},
    } as unknown as SVGSVGElement;
  }

  return root;
};
