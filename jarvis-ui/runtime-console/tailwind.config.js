/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        surface:  "#0f1117",
        panel:    "#161b27",
        border:   "#1e2535",
        accent:   "#3b82f6",
        success:  "#22c55e",
        warning:  "#f59e0b",
        danger:   "#ef4444",
        muted:    "#64748b",
        dim:      "#1e293b",
      },
      fontFamily: { mono: ["JetBrains Mono", "Fira Code", "monospace"] },
    },
  },
  plugins: [],
};
