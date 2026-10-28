
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

app.get("/api/health", (req, res) => {
  res.json({
    status: "online",
    app: "AI Command Center",
    message: "Server berjalan dengan baik."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`AI Command Center running on port ${PORT}`);
});
