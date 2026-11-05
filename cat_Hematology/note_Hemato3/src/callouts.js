import { JSDOM } from "jsdom";

function createCalloutBox(
    document,
    type,
    contentHtml
) {
    const box =
        document.createElement("div");

    box.className =
        `calloutBox calloutBox--${type}`;

    box.dataset.box = type;

    const titles = {
        definition: "تعریف",
        example: "مثال",
        important: "نکته مهم",
        review: "نیازمند بررسی"
    };

    const title =
        document.createElement("div");

    title.className =
        "calloutBoxTitle";

    title.textContent =
        titles[type] || "";

    box.appendChild(title);

    const content =
        document.createElement("div");

    content.className =
        "calloutBoxContent";

    content.innerHTML =
        contentHtml;

    box.appendChild(content);

    return box;
}

function createQuestionBox(
    document,
    type,
    number,
    content
) {
    const questionBox =
        document.createElement("div");

    questionBox.className =
        `questionBox questionBox--${type}`;

    questionBox.dataset.question = type;
    questionBox.dataset.questionNumber = number;

    const lines =
        content
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "");

    const answerIndex =
        lines.findIndex(
            (line) => line === "[ANSWER]"
        );

    const questionLines =
        answerIndex === -1
            ? lines
            : lines.slice(0, answerIndex);

    const answerLines =
        answerIndex === -1
            ? []
            : lines.slice(answerIndex + 1);

    const questionText = [];
    const options = [];

    questionLines.forEach((line) => {
        const optionMatch =
            line.match(
                /^\[OPTION:([A-D])\]\s*(.*)$/i
            );

        if (optionMatch) {
            options.push({
                letter:
                    optionMatch[1].toUpperCase(),
                text:
                    optionMatch[2]
            });

            return;
        }

        questionText.push(line);
    });

    let correctAnswer = null;
    const answerText = [];

    answerLines.forEach((line) => {
        const correctMatch =
            line.match(
                /^\[CORRECT:([A-D])\]$/i
            );

        if (correctMatch) {
            correctAnswer =
                correctMatch[1].toUpperCase();

            return;
        }

        answerText.push(line);
    });

    const header =
        document.createElement("div");

    header.className =
        "questionBoxHeader";

    header.textContent =
        `سؤال ${number}`;

    questionBox.appendChild(header);

    const prompt =
        document.createElement("div");

    prompt.className =
        "questionBoxPrompt";

    questionText.forEach((line) => {
        const paragraph =
            document.createElement("p");

        paragraph.textContent = line;

        prompt.appendChild(paragraph);
    });

    questionBox.appendChild(prompt);

    if (type === "mcq") {
        options.forEach((option) => {
            const optionElement =
                document.createElement("button");

            optionElement.type =
                "button";

            optionElement.className =
                "questionOption";

            optionElement.dataset.option =
                option.letter;

            const letter =
                document.createElement("span");

            letter.className =
                "questionOptionLetter";

            letter.textContent =
                option.letter;

            const text =
                document.createElement("span");

            text.className =
                "questionOptionText";

            text.textContent =
                option.text;

            optionElement.appendChild(letter);
            optionElement.appendChild(text);

            questionBox.appendChild(
                optionElement
            );
        });
    }

    if (
        answerText.length > 0 ||
        correctAnswer
    ) {
        const answer =
            document.createElement("div");

        answer.className =
            "questionBoxAnswer";

answer.hidden = true;
answer.classList.add(
    "questionBoxAnswer--hidden"
);

        answerText.forEach((line) => {
            const paragraph =
                document.createElement("p");

            paragraph.textContent = line;

            answer.appendChild(paragraph);
        });

        if (correctAnswer) {
            const correct =
                document.createElement("div");

            correct.className =
                "questionCorrect";

            correct.dataset.correct =
                correctAnswer;

            const label =
                document.createElement("span");

            label.className =
                "questionCorrectLabel";

            label.textContent =
                "پاسخ صحیح:";

            const value =
                document.createElement("strong");

            value.textContent =
                correctAnswer;

            correct.appendChild(label);
            correct.appendChild(value);

            answer.appendChild(correct);
        }

        questionBox.appendChild(answer);

        if (type === "essay") {
            const answerToggle =
                document.createElement("button");

            answerToggle.type =
                "button";

            answerToggle.className =
                "questionAnswerToggle";

            answerToggle.textContent =
                "نمایش پاسخ";

            answerToggle.setAttribute(
                "aria-expanded",
                "false"
            );

            questionBox.appendChild(
                answerToggle
            );
        }
    }

    return questionBox;
}

function transformBlockquote(
    document,
    blockquote
) {
    const paragraph =
        blockquote.firstElementChild;

    if (
        !paragraph ||
        paragraph.tagName !== "P"
    ) {
        return null;
    }

    const content =
        paragraph.innerHTML;

    const text =
        paragraph.textContent;

    const boxMatch =
        text.match(
            /^\[BOX:(DEFINITION|EXAMPLE|IMPORTANT|REVIEW)\]\s*([\s\S]*)$/i
        );

    if (boxMatch) {
        const type =
            boxMatch[1].toLowerCase();

        const markerText =
            `[BOX:${boxMatch[1]}]`;

        const markerIndex =
            content.indexOf(markerText);

        const contentHtml =
            markerIndex === -1
                ? ""
                : content
                    .slice(
                        markerIndex +
                        markerText.length
                    )
                    .trim();

        return createCalloutBox(
            document,
            type,
            contentHtml
        );
    }

    const essayMatch =
        text.match(
            /^\[QUESTION:ESSAY:(\d+)\]\s*([\s\S]*)$/i
        );

    if (essayMatch) {
        const marker =
            `[QUESTION:ESSAY:${essayMatch[1]}]`;

        const markerIndex =
            content.indexOf(marker);

        const questionContent =
            markerIndex === -1
                ? ""
                : content
                    .slice(
                        markerIndex +
                        marker.length
                    )
                    .trim();

        return createQuestionBox(
            document,
            "essay",
            essayMatch[1],
            questionContent
        );
    }

    const mcqMatch =
        text.match(
            /^\[QUESTION:MCQ:(\d+)\]\s*([\s\S]*)$/i
        );

    if (mcqMatch) {
        const marker =
            `[QUESTION:MCQ:${mcqMatch[1]}]`;

        const markerIndex =
            content.indexOf(marker);

        const questionContent =
            markerIndex === -1
                ? ""
                : content
                    .slice(
                        markerIndex +
                        marker.length
                    )
                    .trim();

        return createQuestionBox(
            document,
            "mcq",
            mcqMatch[1],
            questionContent
        );
    }

    return null;
}

export function applyCallouts(htmlContent) {
    if (
        typeof htmlContent !== "string"
    ) {
        return htmlContent;
    }

    const dom =
        new JSDOM(
            `<body>${htmlContent}</body>`
        );

    const document =
        dom.window.document;

    const blockquotes =
        Array.from(
            document.querySelectorAll(
                "blockquote"
            )
        );

    blockquotes.forEach(
        (blockquote) => {
            const replacement =
                transformBlockquote(
                    document,
                    blockquote
                );

            if (replacement) {
                blockquote.replaceWith(
                    replacement
                );
            }
        }
    );

    return document.body.innerHTML;
}
