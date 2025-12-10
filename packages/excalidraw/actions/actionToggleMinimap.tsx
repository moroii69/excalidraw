import { CODES, KEYS } from "@excalidraw/common";

import { CaptureUpdateAction } from "@excalidraw/element";

import { RectangleIcon } from "../components/icons";

import { register } from "./register";

export const actionToggleMinimap = register({
  name: "toggleMinimap",
  label: "buttons.toggleMinimap",
  icon: RectangleIcon,
  viewMode: true,
  trackEvent: {
    category: "canvas",
    predicate: (appState) => !appState.showMinimap,
  },
  perform(elements, appState) {
    return {
      appState: {
        ...appState,
        showMinimap: !this.checked!(appState),
      },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    };
  },
  checked: (appState) => appState.showMinimap,
  predicate: (elements, appState, appProps, app) => {
    return app.editorInterface.formFactor !== "phone";
  },
  keyTest: (event) =>
    !event[KEYS.CTRL_OR_CMD] &&
    !event.altKey &&
    !event.shiftKey &&
    event.code === CODES.M,
});
