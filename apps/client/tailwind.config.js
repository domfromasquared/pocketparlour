// apps/client/tailwind.config.js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        neon: "0 0 0.75rem rgba(120, 255, 240, 0.35)"
      }
    }
  },
  plugins: []
};
