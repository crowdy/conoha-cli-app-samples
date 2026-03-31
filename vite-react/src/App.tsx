import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <div className="container">
      <h1>React on ConoHa</h1>
      <p>Deployed with <code>conoha app deploy</code></p>
      <div className="card">
        <button onClick={() => setCount((c) => c + 1)}>
          Count: {count}
        </button>
      </div>
    </div>
  );
}
