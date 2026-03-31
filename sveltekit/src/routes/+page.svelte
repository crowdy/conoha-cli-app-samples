<script lang="ts">
  let count = $state(0);
</script>

<svelte:head>
  <title>SvelteKit on ConoHa</title>
</svelte:head>

<div class="container">
  <h1>SvelteKit on ConoHa</h1>
  <p>Deployed with <code>conoha app deploy</code></p>
  <div class="card">
    <button onclick={() => count++}>
      Count: {count}
    </button>
  </div>
</div>

<style>
  .container {
    text-align: center;
    padding: 2rem;
  }
  h1 {
    font-size: 2.5rem;
    margin-bottom: 1rem;
  }
  p {
    font-size: 1.2rem;
    color: #666;
    margin-bottom: 2rem;
  }
  .card {
    padding: 1rem;
  }
  button {
    padding: 0.75rem 2rem;
    font-size: 1.1rem;
    background: #ff3e00;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.2s;
  }
  button:hover {
    background: #d63600;
  }
</style>
