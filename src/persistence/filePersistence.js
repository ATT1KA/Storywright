// ─── FILE-BASED PERSISTENCE ─────────────────────────────────────────────────
// Uses the File System Access API (showSaveFilePicker / showOpenFilePicker)
// when available, falling back to download/upload for older browsers.
// ─────────────────────────────────────────────────────────────────────────────

const JSON_FILE_OPTIONS = {
  types: [
    {
      description: "Storywright Project",
      accept: { "application/json": [".json"] },
    },
  ],
};

/**
 * True when the browser supports showSaveFilePicker / showOpenFilePicker.
 * (Chrome 86+, Edge 86+, Opera 72+; NOT Firefox or Safari as of mid-2025.)
 */
export const hasFileSystemAccess = () =>
  typeof window !== "undefined" &&
  typeof window.showSaveFilePicker === "function" &&
  typeof window.showOpenFilePicker === "function";

// ─── SAVE ────────────────────────────────────────────────────────────────────

/**
 * Save project state to a .json file on disk.
 *
 * File System Access path: opens a native Save dialog; user picks location.
 * Fallback path: triggers a browser download.
 *
 * @param {Object} state        – full project state to persist
 * @param {string} suggestedName – default filename (without extension)
 * @returns {Promise<{ name: string, method: "fileSystem" | "download" }>}
 */
export async function saveProjectToFile(state, suggestedName = "storywright-project") {
  const json = JSON.stringify(state, null, 2);
  const filename = `${sanitizeFilename(suggestedName)}.json`;

  if (hasFileSystemAccess()) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        ...JSON_FILE_OPTIONS,
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      return { name: handle.name, method: "fileSystem" };
    } catch (err) {
      // User cancelled the dialog — not an error
      if (err.name === "AbortError") return null;
      throw err;
    }
  }

  // Fallback: trigger a download
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { name: filename, method: "download" };
}

// ─── LOAD ────────────────────────────────────────────────────────────────────

/**
 * Open a .json file from disk and return its parsed contents.
 *
 * File System Access path: opens a native Open dialog.
 * Fallback path: creates a hidden <input type="file"> and resolves on change.
 *
 * @returns {Promise<{ data: Object, name: string, method: "fileSystem" | "upload" } | null>}
 *          null when the user cancels.
 */
export async function loadProjectFromFile() {
  if (hasFileSystemAccess()) {
    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        ...JSON_FILE_OPTIONS,
      });
      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text);
      return { data, name: file.name, method: "fileSystem" };
    } catch (err) {
      if (err.name === "AbortError") return null;
      throw err;
    }
  }

  // Fallback: hidden file input
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) { resolve(null); return; }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        resolve({ data, name: file.name, method: "upload" });
      } catch (err) {
        reject(err);
      }
    };
    // Handle cancel (focus returns without selection)
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      setTimeout(() => {
        if (!input.files || input.files.length === 0) resolve(null);
      }, 500);
    };
    window.addEventListener("focus", onFocus);
    input.click();
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sanitizeFilename(name) {
  return (name || "storywright-project")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .replace(/\s+/g, "-")
    .replace(/—/g, "-")
    .slice(0, 100);
}
