const STORAGE_KEY = "regSpeedRunnerState";

const DEFAULT_STATE = {
  enabled: true,
  currentCol: 0,
  deletedCourses: [],
  courses: [
    { name: "SDS 313", uniques: ["62740", "62745", "62750"], row: 0, color: "#2f80ed" },
    { name: "M408D", uniques: ["55510", "55515"], row: 0, color: "#d97706" },
    { name: "BIO 315H", uniques: ["49120", "49125"], row: 0, color: "#a855f7" }
  ]
};

chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_STATE });
  }
});
