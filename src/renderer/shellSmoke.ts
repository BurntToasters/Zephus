/** DOM and editor smoke checks. The Tauri host runs this when ZEPHUS_SMOKE=1. */

export async function runShellSmoke(): Promise<string[]> {
  const failures: string[] = [];
  const wait = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (condition: unknown, message: string) => {
    if (!condition) failures.push(message);
  };

  const closeModalIfOpen = async () => {
    const overlay = document.getElementById("modal-overlay");
    if (!overlay || overlay.classList.contains("hidden")) return;
    const buttons = Array.from(
      document.querySelectorAll("#modal-actions button"),
    );
    const closeBtn = buttons.find((button) =>
      /close|cancel|look around/i.test(button.textContent || ""),
    );
    if (closeBtn instanceof HTMLElement) {
      closeBtn.click();
      await wait(180);
    }
  };

  try {
    assert(!!window.zephus, "window.zephus is missing.");
    assert(!!document.getElementById("view-start"), "Missing #view-start.");
    assert(!!document.getElementById("btn-open"), "Missing #btn-open.");
    assert(!!document.getElementById("tab-settings"), "Missing #tab-settings.");
    assert(!!document.getElementById("tab-recent"), "Missing #tab-recent.");
    assert(!!document.getElementById("tab-create"), "Missing #tab-create.");
    assert(!!document.getElementById("recent-list"), "Missing #recent-list.");
    assert(
      !!document.getElementById("sidebar-update-status"),
      "Missing #sidebar-update-status.",
    );
    assert(
      !!document.getElementById("theme-list-container"),
      "Missing #theme-list-container.",
    );

    await wait(400);
    await closeModalIfOpen();

    const settingsBtn = document.getElementById("tab-settings");
    const overlay = document.getElementById("modal-overlay");
    if (settingsBtn instanceof HTMLElement && overlay instanceof HTMLElement) {
      settingsBtn.click();
      await wait(280);
      assert(
        document.getElementById("pane-settings")?.classList.contains("active"),
        "Settings pane did not open.",
      );
    }

    const createTab = document.getElementById("tab-create");
    const themeContainer = document.getElementById("theme-list-container");
    if (
      createTab instanceof HTMLElement &&
      themeContainer instanceof HTMLElement
    ) {
      createTab.click();
      for (let i = 0; i < 20; i += 1) {
        if (themeContainer.querySelector(".theme-card")) break;
        await wait(250);
      }
      assert(
        themeContainer.querySelectorAll(".theme-card").length > 0,
        "Theme previews did not render.",
      );
    }

    const createBtn = document.getElementById("btn-create");
    if (createBtn instanceof HTMLButtonElement) {
      assert(
        createBtn.disabled,
        "Create button should stay disabled until a theme is selected.",
      );
    }

    if (typeof window.__zephusRunEditorSmoke === "function") {
      const editorFailures = await window.__zephusRunEditorSmoke();
      for (const failure of editorFailures) failures.push(failure);
    } else {
      failures.push("Editor smoke hook is missing.");
    }
  } catch (error) {
    failures.push(
      "Smoke execution failed: " +
        (error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error)),
    );
  }

  return failures;
}
