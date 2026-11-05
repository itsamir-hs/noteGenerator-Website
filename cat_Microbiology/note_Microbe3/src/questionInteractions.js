function initializeEssayQuestions() {
    const questions =
        document.querySelectorAll(
            ".questionBox--essay"
        );

    questions.forEach((question) => {
        const answer =
            question.querySelector(
                ".questionBoxAnswer"
            );

        const toggle =
            question.querySelector(
                ".questionAnswerToggle"
            );

        if (!answer || !toggle) {
            return;
        }

        toggle.addEventListener(
            "click",
            () => {
                const isHidden =
                    answer.hidden;

                answer.hidden =
                    !isHidden;

                answer.classList.toggle(
                    "questionBoxAnswer--hidden",
                    !isHidden
                );

                toggle.textContent =
                    isHidden
                        ? "بستن پاسخ"
                        : "نمایش پاسخ";

                toggle.setAttribute(
                    "aria-expanded",
                    String(isHidden)
                );
            }
        );
    });
}

function initializeMcqQuestions() {
    const questions =
        document.querySelectorAll(
            ".questionBox--mcq"
        );

    questions.forEach((question) => {
        const options =
            question.querySelectorAll(
                ".questionOption"
            );

        const correctElement =
            question.querySelector(
                ".questionCorrect"
            );

        const answer =
            question.querySelector(
                ".questionBoxAnswer"
            );

        if (
            options.length === 0 ||
            !correctElement
        ) {
            return;
        }

        const correctAnswer =
            correctElement.dataset.correct;

        options.forEach((option) => {
            option.addEventListener(
                "click",
                () => {
                    if (
                        question.classList.contains(
                            "isAnswered"
                        )
                    ) {
                        return;
                    }

                    const selectedAnswer =
                        option.dataset.option;

                    question.classList.add(
                        "isAnswered"
                    );

                    options.forEach(
                        (item) => {
                            item.disabled = true;
                        }
                    );

                    if (
                        selectedAnswer ===
                        correctAnswer
                    ) {
                        option.classList.add(
                            "isCorrect"
                        );
                    } else {
                        option.classList.add(
                            "isWrong"
                        );

                        const correctOption =
                            question.querySelector(
                                `.questionOption[data-option="${correctAnswer}"]`
                            );

                        if (correctOption) {
                            correctOption.classList.add(
                                "isCorrect"
                            );
                        }
                    }

                    if (answer) {
                        answer.hidden = false;

                        answer.classList.remove(
                            "questionBoxAnswer--hidden"
                        );
                    }
                }
            );
        });
    });
}

function initializeQuestionInteractions() {
    initializeEssayQuestions();
    initializeMcqQuestions();
}

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        initializeQuestionInteractions
    );
} else {
    initializeQuestionInteractions();
}
