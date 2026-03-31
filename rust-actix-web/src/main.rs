use actix_web::{web, App, HttpServer, HttpResponse, Responder};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Serialize, Clone)]
struct Message {
    id: u32,
    text: String,
}

#[derive(Deserialize)]
struct CreateMessage {
    text: String,
}

struct AppState {
    messages: Mutex<Vec<Message>>,
    next_id: Mutex<u32>,
}

async fn index() -> impl Responder {
    HttpResponse::Ok().content_type("text/html").body(INDEX_HTML)
}

async fn list_messages(data: web::Data<AppState>) -> impl Responder {
    let messages = data.messages.lock().unwrap();
    HttpResponse::Ok().json(&*messages)
}

async fn create_message(
    data: web::Data<AppState>,
    body: web::Json<CreateMessage>,
) -> impl Responder {
    if body.text.is_empty() {
        return HttpResponse::BadRequest().json(serde_json::json!({"error": "text is required"}));
    }
    let mut messages = data.messages.lock().unwrap();
    let mut next_id = data.next_id.lock().unwrap();
    let msg = Message {
        id: *next_id,
        text: body.text.clone(),
    };
    *next_id += 1;
    messages.push(msg.clone());
    HttpResponse::Created().json(msg)
}

async fn delete_message(
    data: web::Data<AppState>,
    path: web::Path<u32>,
) -> impl Responder {
    let id = path.into_inner();
    let mut messages = data.messages.lock().unwrap();
    if let Some(pos) = messages.iter().position(|m| m.id == id) {
        messages.remove(pos);
        HttpResponse::NoContent().finish()
    } else {
        HttpResponse::NotFound().json(serde_json::json!({"error": "not found"}))
    }
}

async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({"status": "ok"}))
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let data = web::Data::new(AppState {
        messages: Mutex::new(Vec::new()),
        next_id: Mutex::new(1),
    });

    println!("Server running on port 3000");

    HttpServer::new(move || {
        App::new()
            .app_data(data.clone())
            .route("/", web::get().to(index))
            .route("/health", web::get().to(health))
            .route("/api/messages", web::get().to(list_messages))
            .route("/api/messages", web::post().to(create_message))
            .route("/api/messages/{id}", web::delete().to(delete_message))
    })
    .bind("0.0.0.0:3000")?
    .run()
    .await
}

const INDEX_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rust Actix on ConoHa</title>
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
    button { padding: 0.5rem 1.5rem; background: #b7410e; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    .delete { background: #d32f2f; font-size: 0.85rem; padding: 0.3rem 0.8rem; }
  </style>
</head>
<body>
  <h1>Rust Actix on ConoHa</h1>
  <div class="form-box">
    <input type="text" id="input" placeholder="Type a message..." required>
    <button onclick="send()">Send</button>
  </div>
  <div id="list"></div>
  <script>
    async function load() {
      const res = await fetch("/api/messages");
      const msgs = await res.json();
      document.getElementById("list").innerHTML = msgs.map(m =>
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
</html>"#;
