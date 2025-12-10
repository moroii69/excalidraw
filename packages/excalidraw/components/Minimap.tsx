import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getCommonBounds } from "@excalidraw/element";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { exportToCanvas } from "../index";
import { zoomToFit } from "../actions/actionCanvas";

import {
  useExcalidrawElements,
  useExcalidrawAppState,
  useExcalidrawSetAppState,
} from "./App";

import type { AppState, BinaryFiles } from "../types";

const MINIMAP_SIZE = 150;
const DEBOUNCE_DELAY = 300;

const Minimap: React.FC = React.memo(() => {
  const elements = useExcalidrawElements();
  const appState = useExcalidrawAppState();
  const setAppState = useExcalidrawSetAppState();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [minimapCanvas, setMinimapCanvas] = useState<HTMLCanvasElement | null>(
    null,
  );
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const isDraggingMinimapRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  const sceneBounds = useMemo(() => {
    if (!elements.length) {
      return null;
    }
    const [minX, minY, maxX, maxY] = getCommonBounds(
      elements as NonDeletedExcalidrawElement[],
    );
    const width = maxX - minX;
    const height = maxY - minY;
    return { minX, minY, maxX, maxY, width, height };
  }, [elements]);

  const minimapScale = useMemo(() => {
    if (!sceneBounds) {
      return 1;
    }
    const scaleX = MINIMAP_SIZE / sceneBounds.width;
    const scaleY = MINIMAP_SIZE / sceneBounds.height;
    return Math.min(scaleX, scaleY, 1); // dont scale up, only down
  }, [sceneBounds]);

  const updateMinimap = useCallback(async () => {
    if (
      !elements.length ||
      !sceneBounds ||
      sceneBounds.width <= 0 ||
      sceneBounds.height <= 0
    ) {
      setMinimapCanvas(null);
      return;
    }

    try {
      const canvas = await exportToCanvas({
        elements: elements as NonDeletedExcalidrawElement[],
        appState: {
          ...appState,
          scrollX: -sceneBounds.minX,
          scrollY: -sceneBounds.minY,
        } as AppState,
        files: {} as BinaryFiles,
        getDimensions: (width: number, height: number) => ({
          width: Math.max(1, sceneBounds.width * minimapScale),
          height: Math.max(1, sceneBounds.height * minimapScale),
          scale: minimapScale,
        }),
        exportPadding: 0,
        exportingFrame: null,
      });

      if (canvas && canvas.width > 0 && canvas.height > 0) {
        setMinimapCanvas(canvas);
      } else {
        console.warn(
          "Minimap canvas has invalid dimensions:",
          canvas?.width,
          canvas?.height,
        );
        setMinimapCanvas(null);
      }
    } catch (error) {
      console.error("Failed to render minimap:", error);
      setMinimapCanvas(null);
    }
  }, [elements, appState, sceneBounds, minimapScale]);

  const debouncedUpdate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(updateMinimap, DEBOUNCE_DELAY);
  }, [updateMinimap]);

  useEffect(() => {
    if (appState.showMinimap && elements.length > 0) {
      debouncedUpdate();
    } else if (!appState.showMinimap || elements.length === 0) {
      // Clear the canvas immediately when minimap is hidden or no elements
      setMinimapCanvas(null);
    }
  }, [
    elements,
    appState.scrollX,
    appState.scrollY,
    appState.zoom.value,
    appState.showMinimap,
    debouncedUpdate,
  ]);

  const viewportRect = useMemo(() => {
    if (!minimapCanvas || !sceneBounds) {
      return null;
    }

    const viewportWidth = appState.width / appState.zoom.value;
    const viewportHeight = appState.height / appState.zoom.value;

    const viewportMinX = -appState.scrollX;
    const viewportMinY = -appState.scrollY;
    const viewportMaxX = viewportMinX + viewportWidth;
    const viewportMaxY = viewportMinY + viewportHeight;

    const minimapViewportMinX =
      (viewportMinX - sceneBounds.minX) * minimapScale;
    const minimapViewportMinY =
      (viewportMinY - sceneBounds.minY) * minimapScale;
    const minimapViewportMaxX =
      (viewportMaxX - sceneBounds.minX) * minimapScale;
    const minimapViewportMaxY =
      (viewportMaxY - sceneBounds.minY) * minimapScale;

    return {
      x: minimapViewportMinX,
      y: minimapViewportMinY,
      width: minimapViewportMaxX - minimapViewportMinX,
      height: minimapViewportMaxY - minimapViewportMinY,
    };
  }, [minimapCanvas, sceneBounds, appState, minimapScale]);

  const handleCanvasMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (!minimapCanvas || !sceneBounds) {
        return;
      }

      isDraggingRef.current = true;
      dragStartRef.current = { x: event.clientX, y: event.clientY };

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      const offsetX = Math.max(0, (MINIMAP_SIZE - minimapCanvas.width) / 2);
      const offsetY = Math.max(0, (MINIMAP_SIZE - minimapCanvas.height) / 2);

      const adjustedClickX = clickX - offsetX;
      const adjustedClickY = clickY - offsetY;

      const sceneX = adjustedClickX / minimapScale + sceneBounds.minX;
      const sceneY = adjustedClickY / minimapScale + sceneBounds.minY;

      const viewportWidth = appState.width / appState.zoom.value;
      const viewportHeight = appState.height / appState.zoom.value;

      const newScrollX = -(sceneX - viewportWidth / 2);
      const newScrollY = -(sceneY - viewportHeight / 2);

      setAppState({
        scrollX: newScrollX,
        scrollY: newScrollY,
      });
    },
    [minimapCanvas, sceneBounds, minimapScale, appState, setAppState],
  );

  const handleCanvasMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (!isDraggingRef.current || !minimapCanvas || !sceneBounds) {
        return;
      }

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const deltaX = event.clientX - dragStartRef.current.x;
      const deltaY = event.clientY - dragStartRef.current.y;

      const sceneDeltaX = deltaX / minimapScale;
      const sceneDeltaY = deltaY / minimapScale;

      setAppState({
        scrollX: appState.scrollX - sceneDeltaX,
        scrollY: appState.scrollY - sceneDeltaY,
      });

      dragStartRef.current = { x: event.clientX, y: event.clientY };
    },
    [minimapCanvas, sceneBounds, minimapScale, appState, setAppState],
  );

  const handleCanvasMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const handleMinimapMouseDown = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest("[data-minimap-header]")) {
        return;
      }

      isDraggingMinimapRef.current = true;
      dragStartRef.current = {
        x: event.clientX - appState.minimapPosition.x,
        y: event.clientY - appState.minimapPosition.y,
      };
      event.preventDefault();

      const handleGlobalMouseMove = (e: MouseEvent) => {
        if (!isDraggingMinimapRef.current) {
          return;
        }

        const newX = e.clientX - dragStartRef.current.x;
        const newY = e.clientY - dragStartRef.current.y;

        const padding = 10;
        const maxX = window.innerWidth - 200 - padding;
        const maxY = window.innerHeight - 200 - padding;

        setAppState({
          minimapPosition: {
            x: Math.max(padding, Math.min(newX, maxX)),
            y: Math.max(padding, Math.min(newY, maxY)),
          },
        });
      };

      const handleGlobalMouseUp = () => {
        isDraggingMinimapRef.current = false;
        document.removeEventListener("mousemove", handleGlobalMouseMove);
        document.removeEventListener("mouseup", handleGlobalMouseUp);
      };

      document.addEventListener("mousemove", handleGlobalMouseMove);
      document.addEventListener("mouseup", handleGlobalMouseUp);
    },
    [appState.minimapPosition, setAppState],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    // clearing canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let offsetX = 0;
    let offsetY = 0;

    if (minimapCanvas && minimapCanvas.width > 0 && minimapCanvas.height > 0) {
      offsetX = Math.max(0, (canvas.width - minimapCanvas.width) / 2);
      offsetY = Math.max(0, (canvas.height - minimapCanvas.height) / 2);

      try {
        ctx.drawImage(minimapCanvas, offsetX, offsetY);
      } catch (error) {
        console.error("Failed to draw minimap canvas:", error);
        return;
      }
    }

    if (viewportRect) {
      const rectX = viewportRect.x + offsetX;
      const rectY = viewportRect.y + offsetY;

      ctx.fillStyle = "rgba(0, 123, 255, 0.2)";
      ctx.fillRect(rectX, rectY, viewportRect.width, viewportRect.height);

      ctx.strokeStyle = appState.theme === "dark" ? "#ffffff" : "#0066cc";
      ctx.lineWidth = 2;
      ctx.strokeRect(rectX, rectY, viewportRect.width, viewportRect.height);
    }
  }, [minimapCanvas, viewportRect, appState.theme]);

  const handleZoomToFit = useCallback(() => {
    const zoomState = zoomToFit({
      targetElements: elements,
      appState,
      fitToViewport: false,
    });
    setAppState(zoomState.appState);
  }, [elements, appState, setAppState]);

  const handleDoubleClick = useCallback(() => {
    handleZoomToFit();
  }, [handleZoomToFit]);

  if (!appState.showMinimap) {
    return null;
  }

  if (
    !elements.length ||
    !minimapCanvas ||
    minimapCanvas.width === 0 ||
    minimapCanvas.height === 0
  ) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        left: `${appState.minimapPosition.x}px`,
        top: `${appState.minimapPosition.y}px`,
        zIndex: 1000,
        backgroundColor: "var(--island-bg-color)",
        boxShadow: "var(--shadow-island)",
        borderRadius: "var(--border-radius-lg)",
        padding: "calc(var(--space-factor) * 1)",
      }}
    >
      <div
        data-minimap-header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px",
          padding: "2px 6px",
          cursor: isDraggingMinimapRef.current ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={handleMinimapMouseDown}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: "500",
            color: "var(--text-primary-color)",
          }}
        >
          Minimap
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "var(--text-primary-color)",
              opacity: 0.8,
            }}
          >
            {Math.round(appState.zoom.value * 100)}%
          </div>
          <div
            style={{
              fontSize: "9px",
              color: "var(--keybinding-color)",
              backgroundColor: "var(--button-gray-1)",
              padding: "1px 3px",
              borderRadius: "2px",
              fontWeight: "500",
              border: "1px solid var(--default-border-color)",
            }}
          >
            M
          </div>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE}
        height={MINIMAP_SIZE}
        style={{
          display: "block",
          borderRadius: "var(--border-radius-md)",
          cursor: "crosshair",
        }}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onMouseLeave={handleCanvasMouseUp}
        onDoubleClick={handleDoubleClick}
      />

      {appState.collaborators &&
        Object.values(appState.collaborators).map((collaborator) => {
          if (!collaborator.pointer || !sceneBounds) {
            return null;
          }

          const collabViewportMinX = -collaborator.pointer.x;
          const collabViewportMinY = -collaborator.pointer.y;
          const collabViewportMaxX =
            collabViewportMinX + appState.width / appState.zoom.value;
          const collabViewportMaxY =
            collabViewportMinY + appState.height / appState.zoom.value;

          const minimapCollabMinX =
            (collabViewportMinX - sceneBounds.minX) * minimapScale;
          const minimapCollabMinY =
            (collabViewportMinY - sceneBounds.minY) * minimapScale;
          const minimapCollabMaxX =
            (collabViewportMaxX - sceneBounds.minX) * minimapScale;
          const minimapCollabMaxY =
            (collabViewportMaxY - sceneBounds.minY) * minimapScale;

          const offsetX = Math.max(
            0,
            (MINIMAP_SIZE - (minimapCanvas?.width || 0)) / 2,
          );
          const offsetY = Math.max(
            0,
            (MINIMAP_SIZE - (minimapCanvas?.height || 0)) / 2,
          );

          return (
            <div
              key={collaborator.socketId || collaborator.id}
              style={{
                position: "absolute",
                left: minimapCollabMinX + offsetX + 8,
                top: minimapCollabMinY + offsetY + 8 + 24,
                width: minimapCollabMaxX - minimapCollabMinX,
                height: minimapCollabMaxY - minimapCollabMinY,
                border: `2px solid ${collaborator.color?.stroke || "#007bff"}`,
                backgroundColor: `${collaborator.color?.stroke || "#007bff"}20`,
                pointerEvents: "none",
                zIndex: 1,
              }}
              title={`${collaborator.username || "Anonymous"}'s view`}
            />
          );
        })}
    </div>
  );
});

Minimap.displayName = "Minimap";

export default Minimap;
