// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindRadioGroupKeyboard, syncRadioGroupTabIndex } from "../radioGroup";

interface RadioSpec {
  checked?: boolean;
  tabIndex?: number;
}

function makeGroup(specs: RadioSpec[]): {
  group: HTMLDivElement;
  radios: HTMLButtonElement[];
} {
  const group = document.createElement("div");
  group.setAttribute("role", "radiogroup");
  const radios = specs.map((spec, index) => {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.setAttribute("role", "radio");
    radio.setAttribute("aria-checked", String(spec.checked === true));
    radio.tabIndex = spec.tabIndex ?? -1;
    radio.dataset["radio"] = String(index);
    group.append(radio);
    return radio;
  });
  document.body.append(group);
  return { group, radios };
}

function press(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function trackClicks(radios: HTMLButtonElement[]): string[] {
  const clicked: string[] = [];
  for (const radio of radios) {
    radio.addEventListener("click", () => {
      clicked.push(radio.dataset["radio"] ?? "");
    });
  }
  return clicked;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("syncRadioGroupTabIndex", () => {
  it("makes the checked radio the only tab stop", () => {
    const { group, radios } = makeGroup([
      { tabIndex: 0 },
      { checked: true },
      { tabIndex: 0 },
    ]);
    syncRadioGroupTabIndex(group);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("falls back to the existing tab stop when none is checked", () => {
    const { group, radios } = makeGroup([{}, { tabIndex: 0 }, {}]);
    syncRadioGroupTabIndex(group);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("falls back to the first radio when none is checked or tabbable", () => {
    const { group, radios } = makeGroup([{}, {}, {}]);
    syncRadioGroupTabIndex(group);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it("handles null and empty groups safely", () => {
    expect(() => syncRadioGroupTabIndex(null)).not.toThrow();
    const group = document.createElement("div");
    expect(() => syncRadioGroupTabIndex(group)).not.toThrow();
  });
});

describe("bindRadioGroupKeyboard", () => {
  it("moves right/down to the next radio and wraps", () => {
    const { group, radios } = makeGroup([{}, {}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);

    press(radios[0]!, "ArrowRight");
    expect(clicked).toEqual(["1"]);

    press(radios[1]!, "ArrowDown");
    expect(clicked).toEqual(["1", "2"]);

    press(radios[2]!, "ArrowRight");
    expect(clicked).toEqual(["1", "2", "0"]);
  });

  it("moves left/up to the previous radio and wraps", () => {
    const { group, radios } = makeGroup([{}, {}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);

    press(radios[0]!, "ArrowLeft");
    expect(clicked).toEqual(["2"]);

    press(radios[2]!, "ArrowUp");
    expect(clicked).toEqual(["2", "1"]);

    press(radios[0]!, "ArrowUp");
    expect(clicked).toEqual(["2", "1", "2"]);
  });

  it("moves to the first/last radio on Home/End", () => {
    const { group, radios } = makeGroup([{}, {}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);

    press(radios[1]!, "Home");
    expect(clicked).toEqual(["0"]);

    press(radios[0]!, "End");
    expect(clicked).toEqual(["0", "2"]);
  });

  it("prevents default only for handled keys", () => {
    const { group, radios } = makeGroup([{}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);

    expect(press(radios[0]!, "ArrowRight").defaultPrevented).toBe(true);
    expect(press(radios[1]!, "Enter").defaultPrevented).toBe(false);
    expect(clicked).toEqual(["1"]);
  });

  it("activates the target radio, focuses it and syncs the tab stop", () => {
    const { group, radios } = makeGroup([{ checked: true }, {}, {}]);
    const clicked = trackClicks(radios);
    radios[1]!.addEventListener("click", () => {
      for (const [index, radio] of radios.entries()) {
        radio.setAttribute("aria-checked", String(index === 1));
      }
    });
    bindRadioGroupKeyboard(group);

    press(radios[0]!, "ArrowRight");

    expect(clicked).toEqual(["1"]);
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("does not add duplicate listeners on repeated binds", () => {
    const { group, radios } = makeGroup([{}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);
    bindRadioGroupKeyboard(group);

    press(radios[0]!, "ArrowRight");
    expect(clicked).toEqual(["1"]);
    expect(() => bindRadioGroupKeyboard(null)).not.toThrow();
  });

  it("ignores non-radio and non-element targets inside the group", () => {
    const { group, radios } = makeGroup([{}, {}]);
    const clicked = trackClicks(radios);
    const label = document.createElement("span");
    const text = document.createTextNode("label");
    group.append(label, text);
    bindRadioGroupKeyboard(group);

    expect(press(label, "ArrowRight").defaultPrevented).toBe(false);
    expect(press(text, "ArrowRight").defaultPrevented).toBe(false);
    expect(clicked).toEqual([]);
  });

  it("ignores a matched radio that is absent from the group list", () => {
    const { group, radios } = makeGroup([{}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);
    const query = vi.spyOn(group, "querySelectorAll");
    query.mockReturnValue([radios[1]!] as unknown as NodeListOf<Element>);

    expect(press(radios[0]!, "ArrowRight").defaultPrevented).toBe(false);
    expect(clicked).toEqual([]);
    query.mockRestore();
  });

  it("ignores a key when the computed next radio is missing", () => {
    const { group, radios } = makeGroup([{}, {}]);
    const clicked = trackClicks(radios);
    bindRadioGroupKeyboard(group);
    const query = vi.spyOn(group, "querySelectorAll");
    query.mockReturnValue([
      radios[0]!,
      undefined,
    ] as unknown as NodeListOf<Element>);

    expect(press(radios[0]!, "ArrowRight").defaultPrevented).toBe(false);
    expect(clicked).toEqual([]);
    query.mockRestore();
  });

  it("syncs the roving tab stop when bound", () => {
    const { group, radios } = makeGroup([{ tabIndex: 0 }, { checked: true }]);
    bindRadioGroupKeyboard(group);
    expect(radios.map((radio) => radio.tabIndex)).toEqual([-1, 0]);
  });
});
