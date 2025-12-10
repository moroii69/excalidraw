import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getCommonBounds } from "@excalidraw/element";
import { ZOOM_STEP } from "@excalidraw/common";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import { exportToCanvas } from "../index";
import { zoomToFit } from "../actions/actionCanvas";
import { getStateForZoom } from "../scene/zoom";
import { getNormalizedZoom } from "../scene/normalize";

import {
  useExcalidrawElements,
  useExcalidrawAppState,
  useExcalidrawSetAppState,
} from "./App";

import type { AppState, BinaryFiles } from "../types";

interface MinimapProps {
  isVisible?: boolean;
  onToggle?: () => void;
}

const MINIMAP_SIZE = 150;
const DEBOUNCE_DELAY = 300;

const Minimap: React.FC<MinimapProps> = React.memo(
  ({ isVisible = true, onToggle }) => {
    const elements = useExcalidrawElements();
    const appState = useExcalidrawAppState();
    const setAppState = useExcalidrawSetAppState();

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [minimapCanvas, setMinimapCanvas] =
      useState<HTMLCanvasElement | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDraggingRef = useRef(false);
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
      if (!elements.length || !sceneBounds) {
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
            width: sceneBounds.width * minimapScale,
            height: sceneBounds.height * minimapScale,
            scale: minimapScale,
          }),
          exportPadding: 0,
          exportingFrame: null,
        });
        setMinimapCanvas(canvas);
      } catch (error) {
        console.error("Failed to render minimap:", error);
      }
    }, [elements, appState, sceneBounds, minimapScale]);

    const debouncedUpdate = useCallback(() => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(updateMinimap, DEBOUNCE_DELAY);
    }, [updateMinimap]);

    useEffect(() => {
      if (isVisible) {
        debouncedUpdate();
      }
    }, [
      elements,
      appState.scrollX,
      appState.scrollY,
      appState.zoom.value,
      isVisible,
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

    const handleMouseDown = useCallback(
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

    const handleMouseMove = useCallback(
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

        const newScrollX = appState.scrollX - sceneDeltaX;
        const newScrollY = appState.scrollY - sceneDeltaY;

        setAppState({
          scrollX: newScrollX,
          scrollY: newScrollY,
        });

        dragStartRef.current = { x: event.clientX, y: event.clientY };
      },
      [minimapCanvas, sceneBounds, minimapScale, appState, setAppState],
    );

    const handleMouseUp = useCallback(() => {
      isDraggingRef.current = false;
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !minimapCanvas) {
        return;
      }

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }

      // clearing canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const offsetX = Math.max(0, (canvas.width - minimapCanvas.width) / 2);
      const offsetY = Math.max(0, (canvas.height - minimapCanvas.height) / 2);

      ctx.drawImage(minimapCanvas, offsetX, offsetY);

      if (viewportRect) {
        const rectX = viewportRect.x + offsetX;
        const rectY = viewportRect.y + offsetY;

        ctx.strokeStyle = appState.theme === "dark" ? "#ffffff" : "#000000";
        ctx.lineWidth = 2;
        ctx.strokeRect(rectX, rectY, viewportRect.width, viewportRect.height);

        ctx.fillStyle = "rgba(0, 123, 255, 0.2)";
        ctx.fillRect(rectX, rectY, viewportRect.width, viewportRect.height);
      }
    }, [minimapCanvas, viewportRect, appState.theme]);

    const handleZoomIn = useCallback(() => {
      const newZoom = getNormalizedZoom(appState.zoom.value + ZOOM_STEP);
      const zoomState = getStateForZoom(
        {
          viewportX: appState.width / 2 + appState.offsetLeft,
          viewportY: appState.height / 2 + appState.offsetTop,
          nextZoom: newZoom,
        },
        appState,
      );
      setAppState({
        ...zoomState,
        userToFollow: null,
      });
    }, [appState, setAppState]);

    const handleZoomOut = useCallback(() => {
      const newZoom = getNormalizedZoom(appState.zoom.value - ZOOM_STEP);
      const zoomState = getStateForZoom(
        {
          viewportX: appState.width / 2 + appState.offsetLeft,
          viewportY: appState.height / 2 + appState.offsetTop,
          nextZoom: newZoom,
        },
        appState,
      );
      setAppState({
        ...zoomState,
        userToFollow: null,
      });
    }, [appState, setAppState]);

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

    if (!isVisible) {
      return null;
    }

    return (
      <div
        style={{
          position: "fixed",
          bottom: "20px",
          right: "20px",
          zIndex: 1000,
          backgroundColor: appState.theme === "dark" ? "#2a2a2a" : "#ffffff",
          border: `1px solid ${appState.theme === "dark" ? "#555" : "#ddd"}`,
          borderRadius: "4px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
          padding: "8px",
          cursor: "grab",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "4px",
            left: "8px",
            backgroundColor: appState.theme === "dark" ? "#444" : "#f0f0f0",
            color: appState.theme === "dark" ? "#fff" : "#000",
            padding: "2px 6px",
            borderRadius: "10px",
            fontSize: "10px",
            fontWeight: "bold",
            zIndex: 1,
          }}
        >
          {Math.round(appState.zoom.value * 100)}%
        </div>

        <div
          style={{
            position: "absolute",
            top: "4px",
            right: "8px",
            display: "flex",
            gap: "2px",
            zIndex: 1,
          }}
        >
          <button
            onClick={handleZoomOut}
            style={{
              width: "20px",
              height: "20px",
              border: "none",
              borderRadius: "3px",
              backgroundColor: appState.theme === "dark" ? "#555" : "#ddd",
              color: appState.theme === "dark" ? "#fff" : "#000",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
            }}
            title="Zoom Out"
          >
            −
          </button>
          <button
            onClick={handleZoomIn}
            style={{
              width: "20px",
              height: "20px",
              border: "none",
              borderRadius: "3px",
              backgroundColor: appState.theme === "dark" ? "#555" : "#ddd",
              color: appState.theme === "dark" ? "#fff" : "#000",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: "bold",
            }}
            title="Zoom In"
          >
            +
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={MINIMAP_SIZE}
          height={MINIMAP_SIZE}
          style={{
            display: "block",
            cursor: isDraggingRef.current ? "grabbing" : "grab",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        />
        {onToggle && (
          <button
            onClick={onToggle}
            style={{
              position: "absolute",
              bottom: "-8px",
              right: "-8px",
              width: "20px",
              height: "20px",
              borderRadius: "50%",
              border: "none",
              backgroundColor: appState.theme === "dark" ? "#555" : "#ddd",
              color: appState.theme === "dark" ? "#fff" : "#000",
              cursor: "pointer",
              fontSize: "12px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        )}

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
                  left: minimapCollabMinX + offsetX,
                  top: minimapCollabMinY + offsetY,
                  width: minimapCollabMaxX - minimapCollabMinX,
                  height: minimapCollabMaxY - minimapCollabMinY,
                  border: `2px solid ${
                    collaborator.color?.stroke || "#007bff"
                  }`,
                  backgroundColor: `${
                    collaborator.color?.stroke || "#007bff"
                  }20`,
                  pointerEvents: "none",
                  zIndex: 1,
                }}
                title={`${collaborator.username || "Anonymous"}'s view`}
              />
            );
          })}
      </div>
    );
  },
);

Minimap.displayName = "Minimap";

export default Minimap;
