
/*
 * Papyrus Highlight System — optimized rewrite
 *
 * Goals:
 * - Keep persisted offsets independent of DOM node structure.
 * - Build a text index once per user operation, not once per highlight.
 * - Store offsets directly; never recalculate every Range when saving.
 * - Erase by cached interval overlap instead of building a Range per highlight.
 * - Restore all stored highlights in one text-node pass.
 * - Keep existing controls, storage keys, colors, mouse/touch behavior.
 */

(() => {
    "use strict";

    const highlightSwitcher = document.querySelector(".highlightSwitcher");
    const highlightToggle = document.querySelector(".highlightToggle");
    const highlightOptions = document.querySelector(".highlightOptions");
    const highlightColors = document.querySelectorAll(".highlightColor");
    const highlightColorInput = document.querySelector(".highlightColorInput");
    const highlightEraser = document.querySelector(".highlightEraser");
    const highlightPowerToggle = document.querySelector(".highlightPowerToggle");
    const highlightContainer = document.querySelector(".noteContainer");

    if (!highlightContainer) return;

    let selectedColor = "#fff176";
    let isEraserActive = false;
    let highlightCounter = 0;
    const highlights = new Map();

    const generatedDateElement = document.querySelector(".generatedDate");
    const generatedDate = generatedDateElement?.textContent.trim();

    const highlightStorageKey = generatedDate
        ? `noteHighlights:${generatedDate}`
        : `noteHighlights:${window.location.pathname}`;

    const highlightPowerStorageKey = "highlightEnabled";

    let isHighlightEnabled = true;

    try {
        isHighlightEnabled =
            localStorage.getItem(highlightPowerStorageKey) !== "false";
    } catch (error) {
        console.warn("Highlight preference could not be read:", error);
    }

    const DEFAULT_COLOR = "#fff176";

    function isHighlightElement(node) {
        return node instanceof Element &&
            node.classList.contains("textHighlight");
    }

    function isInsideStickyNotes(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE
            ? node
            : node?.parentElement;

        return Boolean(element?.closest(".stickyNotesLayer"));
    }

    /*
     * Creates one index for the current text DOM.
     * Sticky-note text is excluded, while text inside existing
     * highlight spans remains part of the document's text offsets.
     */
    function buildTextIndex(container = highlightContainer) {
        const textNodes = [];
        const starts = new Map();
        const ends = new Map();

        let totalLength = 0;

        function visit(node) {
            starts.set(node, totalLength);

            if (
                node.nodeType === Node.ELEMENT_NODE &&
                node.matches(".stickyNotesLayer")
            ) {
                ends.set(node, totalLength);
                return;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                const length = node.nodeValue?.length || 0;

                textNodes.push({
                    node,
                    start: totalLength,
                    end: totalLength + length
                });

                totalLength += length;
                ends.set(node, totalLength);
                return;
            }

            for (const child of node.childNodes || []) {
                visit(child);
            }

            ends.set(node, totalLength);
        }

        visit(container);

        function pointOffset(node, offset) {
            if (
                !node ||
                !starts.has(node) ||
                isInsideStickyNotes(node)
            ) {
                return null;
            }

            if (node.nodeType === Node.TEXT_NODE) {
                const length = node.nodeValue?.length || 0;

                return starts.get(node) +
                    Math.max(0, Math.min(offset, length));
            }

            if (
                node.nodeType === Node.ELEMENT_NODE ||
                node.nodeType === Node.DOCUMENT_FRAGMENT_NODE
            ) {
                const children = node.childNodes || [];

                const childLimit = Math.max(
                    0,
                    Math.min(offset, children.length)
                );

                if (childLimit === 0) {
                    return starts.get(node);
                }

                return ends.get(children[childLimit - 1]) ??
                    starts.get(node);
            }

            return null;
        }

        function pointAt(targetOffset) {
            if (!textNodes.length) return null;

            const target = Math.max(
                0,
                Math.min(targetOffset, totalLength)
            );

            let low = 0;
            let high = textNodes.length - 1;

            while (low <= high) {
                const mid = (low + high) >> 1;
                const item = textNodes[mid];

                if (target < item.start) {
                    high = mid - 1;
                } else if (target > item.end) {
                    low = mid + 1;
                } else {
                    return {
                        node: item.node,
                        offset: target - item.start
                    };
                }
            }

            const last = textNodes[textNodes.length - 1];

            return {
                node: last.node,
                offset: last.end - last.start
            };
        }

        function rangeOffsets(range) {
            if (!range) return null;

            const start = pointOffset(
                range.startContainer,
                range.startOffset
            );

            const end = pointOffset(
                range.endContainer,
                range.endOffset
            );

            if (start === null || end === null) return null;

            return {
                start: Math.min(start, end),
                end: Math.max(start, end)
            };
        }

        return {
            container,
            textNodes,
            starts,
            ends,
            totalLength,
            pointOffset,
            pointAt,
            rangeOffsets
        };
    }

    function getHighlightTextColor(color) {
        const match = /^#([0-9a-f]{6})$/i.exec(color || "");

        if (!match) return "#1A1A1A";

        const hex = match[1];

        const red = parseInt(hex.slice(0, 2), 16);
        const green = parseInt(hex.slice(2, 4), 16);
        const blue = parseInt(hex.slice(4, 6), 16);

        const luminance =
            0.299 * red +
            0.587 * green +
            0.114 * blue;

        return luminance >= 150 ? "#171717" : "#F8FAFC";
    }

    function applyHighlightStyle(element, color) {
        element.style.backgroundColor = color;
        element.style.color = getHighlightTextColor(color);
        element.style.borderRadius = "3px";
        element.style.boxDecorationBreak = "clone";
        element.style.webkitBoxDecorationBreak = "clone";
        element.style.boxShadow = "none";
        element.style.textShadow = "none";
    }

    function normalizeColor(color) {
        return typeof color === "string" &&
            /^#[0-9a-f]{6}$/i.test(color)
            ? color
            : DEFAULT_COLOR;
    }

    function createSpan(color, start, end) {
        const span = document.createElement("span");

        span.className = "textHighlight";
        span.dataset.highlightColor = color;
        span.dataset.highlightStart = String(start);
        span.dataset.highlightEnd = String(end);

        applyHighlightStyle(span, color);

        return span;
    }

    function registerHighlight(element, color, start, end) {
        const id = `noteHighlight${++highlightCounter}`;

        element.dataset.highlightId = id;
        element.dataset.highlightStart = String(start);
        element.dataset.highlightEnd = String(end);
        element.dataset.highlightColor = color;

        highlights.set(id, {
            id,
            element,
            color,
            start,
            end
        });

        return id;
    }

    /*
     * Save cached offsets directly.
     * No document traversal or Range calculation is needed here.
     */
    function saveHighlights() {
        const stored = [];

        for (const item of highlights.values()) {
            if (item.end <= item.start) continue;

            stored.push({
                range: {
                    start: item.start,
                    end: item.end
                },
                color: item.color
            });
        }

        try {
            localStorage.setItem(
                highlightStorageKey,
                JSON.stringify(stored)
            );
        } catch (error) {
            console.error("Failed to save highlights:", error);
        }
    }

    function getHighlightSelection() {
        const selection = window.getSelection();

        if (
            !selection ||
            selection.rangeCount === 0 ||
            selection.isCollapsed
        ) {
            return null;
        }

        const range = selection.getRangeAt(0);

        if (
            !highlightContainer.contains(range.startContainer) ||
            !highlightContainer.contains(range.endContainer) ||
            isInsideStickyNotes(range.startContainer) ||
            isInsideStickyNotes(range.endContainer)
        ) {
            return null;
        }

        return range.cloneRange();
    }

    function wrapTextNodePortion(
        item,
        absoluteStart,
        absoluteEnd,
        color
    ) {
        const { node } = item;

        if (
            !node.parentNode ||
            node.nodeType !== Node.TEXT_NODE
        ) {
            return null;
        }

        const localStart = Math.max(
            0,
            absoluteStart - item.start
        );

        const localEnd = Math.min(
            item.end - item.start,
            absoluteEnd - item.start
        );

        if (localStart >= localEnd) return null;

        const value = node.nodeValue || "";
        const fragment = document.createDocumentFragment();

        if (localStart > 0) {
            fragment.appendChild(
                document.createTextNode(value.slice(0, localStart))
            );
        }

        const span = createSpan(
            color,
            absoluteStart,
            absoluteEnd
        );

        span.textContent = value.slice(localStart, localEnd);
        fragment.appendChild(span);

        if (localEnd < value.length) {
            fragment.appendChild(
                document.createTextNode(value.slice(localEnd))
            );
        }

        node.parentNode.replaceChild(fragment, node);

        registerHighlight(
            span,
            color,
            absoluteStart,
            absoluteEnd
        );

        return span;
    }

    function createHighlightFromOffsets(index, start, end, color) {
        if (start >= end) return;

        const safeColor = normalizeColor(color);

        const affected = index.textNodes.filter(
            item => item.start < end && item.end > start
        );

        /*
         * Work backwards so mutations to later text nodes
         * cannot invalidate earlier node references.
         */
        for (let i = affected.length - 1; i >= 0; i--) {
            const item = affected[i];

            const segmentStart = Math.max(start, item.start);
            const segmentEnd = Math.min(end, item.end);

            wrapTextNodePortion(
                item,
                segmentStart,
                segmentEnd,
                safeColor
            );
        }
    }

    function createHighlight(range) {
        const index = buildTextIndex();
        const offsets = index.rangeOffsets(range);

        if (!offsets || offsets.start >= offsets.end) return;

        createHighlightFromOffsets(
            index,
            offsets.start,
            offsets.end,
            selectedColor
        );

        saveHighlights();
    }

    function unwrapHighlight(element) {
        if (
            !isHighlightElement(element) ||
            !element.parentNode
        ) {
            return;
        }

        const parent = element.parentNode;
        const fragment = document.createDocumentFragment();

        while (element.firstChild) {
            fragment.appendChild(element.firstChild);
        }

        parent.replaceChild(fragment, element);

        /*
         * Do not normalize after every removal.
         * Repeated normalize() calls can be expensive.
         */
    }

    function getElementDepth(element) {
        let depth = 0;

        for (
            let node = element;
            node && node !== highlightContainer;
            node = node.parentElement
        ) {
            depth++;
        }

        return depth;
    }

    function removeHighlight(selectionRange) {
        const index = buildTextIndex();
        const selectionOffsets = index.rangeOffsets(selectionRange);

        if (
            !selectionOffsets ||
            selectionOffsets.start >= selectionOffsets.end
        ) {
            return;
        }

        const toRemove = [];

        for (const item of highlights.values()) {
            if (
                item.end > selectionOffsets.start &&
                item.start < selectionOffsets.end
            ) {
                toRemove.push(item);
            }
        }

        /*
         * Remove deepest spans first to handle nested highlights safely.
         * Existing behavior is preserved: an intersecting highlight span
         * is removed in full, rather than partially erased.
         */
        toRemove.sort(
            (a, b) =>
                getElementDepth(b.element) -
                getElementDepth(a.element)
        );

        for (const item of toRemove) {
            if (item.element?.isConnected) {
                unwrapHighlight(item.element);
            }

            highlights.delete(item.id);
        }

        saveHighlights();
    }

    /*
     * Restore saved highlights using one initial text index.
     * Overlapping intervals are rebuilt as nested spans.
     */
    function restoreAllHighlights(records) {
        const index = buildTextIndex();

        const valid = records
            .map((record, order) => {
                const range = record?.range;

                if (
                    !range ||
                    !Number.isFinite(range.start) ||
                    !Number.isFinite(range.end)
                ) {
                    return null;
                }

                const start = Math.max(
                    0,
                    Math.min(index.totalLength, Math.trunc(range.start))
                );

                const end = Math.max(
                    0,
                    Math.min(index.totalLength, Math.trunc(range.end))
                );

                if (start >= end) return null;

                return {
                    start,
                    end,
                    color: normalizeColor(record.color),
                    order
                };
            })
            .filter(Boolean);

        /*
         * Process text nodes in reverse order so DOM mutations
         * do not affect references to text nodes still to process.
         */
        for (
            let nodeIndex = index.textNodes.length - 1;
            nodeIndex >= 0;
            nodeIndex--
        ) {
            const item = index.textNodes[nodeIndex];

            if (
                !item.node.parentNode ||
                item.start === item.end
            ) {
                continue;
            }

            const boundaries = new Set([
                item.start,
                item.end
            ]);

            const overlapping = [];

            for (const record of valid) {
                if (
                    record.start < item.end &&
                    record.end > item.start
                ) {
                    overlapping.push(record);

                    boundaries.add(
                        Math.max(item.start, record.start)
                    );

                    boundaries.add(
                        Math.min(item.end, record.end)
                    );
                }
            }

            if (!overlapping.length) continue;

            const cuts = [...boundaries].sort((a, b) => a - b);
            const fragment = document.createDocumentFragment();
            const created = [];
            const originalText = item.node.nodeValue || "";

            for (let i = 0; i < cuts.length - 1; i++) {
                const segmentStart = cuts[i];
                const segmentEnd = cuts[i + 1];

                if (segmentStart >= segmentEnd) continue;

                let inner = document.createTextNode(
                    originalText.slice(
                        segmentStart - item.start,
                        segmentEnd - item.start
                    )
                );

                const active = overlapping
                    .filter(
                        record =>
                            record.start <= segmentStart &&
                            record.end >= segmentEnd
                    )
                    .sort((a, b) => a.order - b.order);

                for (let j = active.length - 1; j >= 0; j--) {
                    const record = active[j];

                    const span = createSpan(
                        record.color,
                        segmentStart,
                        segmentEnd
                    );

                    span.appendChild(inner);
                    inner = span;

                    created.push({
                        span,
                        record,
                        start: segmentStart,
                        end: segmentEnd
                    });
                }

                fragment.appendChild(inner);
            }

            item.node.parentNode.replaceChild(
                fragment,
                item.node
            );

            for (const entry of created) {
                registerHighlight(
                    entry.span,
                    entry.record.color,
                    entry.start,
                    entry.end
                );
            }
        }
    }

    function loadHighlights() {
        let stored = null;

        try {
            stored = localStorage.getItem(highlightStorageKey);
        } catch (error) {
            console.error("Failed to read highlights:", error);
            return;
        }

        if (!stored) return;

        try {
            const parsed = JSON.parse(stored);

            if (!Array.isArray(parsed)) return;

            restoreAllHighlights(parsed);

            /*
             * Save the restored intervals in the optimized format.
             */
            saveHighlights();
        } catch (error) {
            console.error("Failed to load highlights:", error);
        }
    }

    function updateHighlightPowerToggle() {
        if (!highlightPowerToggle) return;

        highlightPowerToggle.classList.toggle(
            "isActive",
            isHighlightEnabled
        );

        highlightPowerToggle.setAttribute(
            "aria-pressed",
            String(isHighlightEnabled)
        );

        const label = highlightPowerToggle.querySelector("span");

        if (label) {
            label.textContent = isHighlightEnabled
                ? "هایلایت روشن"
                : "هایلایت خاموش";
        }
    }

    function toggleHighlightPower() {
        isHighlightEnabled = !isHighlightEnabled;

        try {
            localStorage.setItem(
                highlightPowerStorageKey,
                String(isHighlightEnabled)
            );
        } catch (error) {
            console.warn(
                "Highlight preference could not be saved:",
                error
            );
        }

        updateHighlightPowerToggle();
    }

    function setHighlightMode(color) {
        selectedColor = normalizeColor(color);
        isEraserActive = false;

        if (highlightEraser) {
            highlightEraser.classList.remove("isActive");
        }

        highlightColors.forEach(button => {
            button.classList.toggle(
                "isActive",
                button.dataset.highlightColor === selectedColor
            );
        });
    }

    function setEraserMode() {
        isEraserActive = true;

        if (highlightEraser) {
            highlightEraser.classList.add("isActive");
        }

        highlightColors.forEach(button => {
            button.classList.remove("isActive");
        });
    }

    function applyHighlight() {
        if (!isHighlightEnabled) return;

        const range = getHighlightSelection();

        if (!range) return;

        if (isEraserActive) {
            removeHighlight(range);
        } else {
            createHighlight(range);
        }

        window.getSelection()?.removeAllRanges();
    }

    let highlightSelectionTimer = null;

    function scheduleHighlightApplication(delay = 0) {
        clearTimeout(highlightSelectionTimer);

        highlightSelectionTimer = setTimeout(
            applyHighlight,
            delay
        );
    }

    document.addEventListener("mouseup", event => {
        if (
            event.target instanceof Element &&
            event.target.closest(".highlightSwitcher")
        ) {
            return;
        }

        scheduleHighlightApplication(0);
    });

    document.addEventListener(
        "touchend",
        event => {
            if (
                event.target instanceof Element &&
                event.target.closest(".highlightSwitcher")
            ) {
                return;
            }

            scheduleHighlightApplication(120);
        },
        { passive: true }
    );

    if (highlightToggle) {
        highlightToggle.addEventListener("click", () => {
            const isOpen =
                highlightSwitcher?.classList.toggle("isOpen") ?? false;

            highlightToggle.setAttribute(
                "aria-expanded",
                String(isOpen)
            );

            if (highlightOptions) {
                highlightOptions.setAttribute(
                    "aria-hidden",
                    String(!isOpen)
                );
            }
        });
    }

    if (highlightPowerToggle) {
        highlightPowerToggle.addEventListener("click", event => {
            event.stopPropagation();
            toggleHighlightPower();
        });
    }

    highlightColors.forEach(button => {
        button.addEventListener("click", () => {
            setHighlightMode(button.dataset.highlightColor);
        });
    });

    if (highlightColorInput) {
        highlightColorInput.addEventListener("input", event => {
            setHighlightMode(event.target.value);
        });
    }

    if (highlightEraser) {
        highlightEraser.addEventListener("click", setEraserMode);
    }

    setHighlightMode(selectedColor);
    updateHighlightPowerToggle();
    loadHighlights();
})();
