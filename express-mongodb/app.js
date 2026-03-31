const express = require("express");
const mongoose = require("mongoose");

const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB
const mongoURL = process.env.MONGO_URL || "mongodb://db:27017/app";
mongoose.connect(mongoURL);

// Post schema
const postSchema = new mongoose.Schema({
  title: { type: String, required: true },
  body: String,
  createdAt: { type: Date, default: Date.now },
});
const Post = mongoose.model("Post", postSchema);

// Routes
app.get("/", async (req, res) => {
  const posts = await Post.find().sort({ createdAt: -1 });
  res.render("index", { posts });
});

app.post("/posts", async (req, res) => {
  await Post.create({ title: req.body.title, body: req.body.body });
  res.redirect("/");
});

app.post("/posts/:id/delete", async (req, res) => {
  await Post.findByIdAndDelete(req.params.id);
  res.redirect("/");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
