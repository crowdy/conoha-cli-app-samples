package main

import (
	"fmt"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

type Message struct {
	ID        int       `json:"id"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"created_at"`
}

var messages []Message
var nextID = 1

func main() {
	app := fiber.New()

	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// List messages
	app.Get("/api/messages", func(c *fiber.Ctx) error {
		return c.JSON(messages)
	})

	// Create message
	app.Post("/api/messages", func(c *fiber.Ctx) error {
		var body struct {
			Text string `json:"text"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid request body"})
		}
		if body.Text == "" {
			return c.Status(400).JSON(fiber.Map{"error": "text is required"})
		}
		msg := Message{
			ID:        nextID,
			Text:      body.Text,
			CreatedAt: time.Now(),
		}
		nextID++
		messages = append(messages, msg)
		return c.Status(201).JSON(msg)
	})

	// Delete message
	app.Delete("/api/messages/:id", func(c *fiber.Ctx) error {
		id, err := c.ParamsInt("id")
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "invalid id"})
		}
		for i, msg := range messages {
			if msg.ID == id {
				messages = append(messages[:i], messages[i+1:]...)
				return c.SendStatus(204)
			}
		}
		return c.Status(404).JSON(fiber.Map{"error": "not found"})
	})

	// Serve index page
	app.Get("/", func(c *fiber.Ctx) error {
		c.Set("Content-Type", "text/html")
		return c.SendString(indexHTML)
	})

	fmt.Println("Server running on port 3000")
	log.Fatal(app.Listen(":3000"))
}

const indexHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Go Fiber on ConoHa</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 700px;
      margin: 2rem auto;
      padding: 0 1rem;
      background: #f5f5f5;
      color: #333;
    }
    h1 { margin-bottom: 1rem; }
    .msg { background: #fff; padding: 1rem; border-radius: 8px; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
    .form-box { background: #fff; padding: 1rem; border-radius: 8px; margin-bottom: 2rem; display: flex; gap: 0.5rem; }
    input { flex: 1; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; }
    button { padding: 0.5rem 1.5rem; background: #00acd7; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    .delete { background: #d32f2f; font-size: 0.85rem; padding: 0.3rem 0.8rem; }
  </style>
</head>
<body>
  <h1>Go Fiber on ConoHa</h1>
  <div class="form-box">
    <input type="text" id="input" placeholder="Type a message..." required>
    <button onclick="send()">Send</button>
  </div>
  <div id="list"></div>
  <script>
    async function load() {
      const res = await fetch("/api/messages");
      const msgs = await res.json();
      const list = document.getElementById("list");
      list.innerHTML = (msgs || []).map(m =>
        '<div class="msg"><span>' + m.text + '</span>' +
        '<button class="delete" onclick="del(' + m.id + ')">Delete</button></div>'
      ).join("");
    }
    async function send() {
      const input = document.getElementById("input");
      const text = input.value.trim();
      if (!text) return;
      await fetch("/api/messages", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({text})
      });
      input.value = "";
      load();
    }
    async function del(id) {
      await fetch("/api/messages/" + id, {method: "DELETE"});
      load();
    }
    document.getElementById("input").addEventListener("keydown", e => {
      if (e.key === "Enter") send();
    });
    load();
  </script>
</body>
</html>`
