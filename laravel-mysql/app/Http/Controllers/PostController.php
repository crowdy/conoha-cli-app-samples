<?php

namespace App\Http\Controllers;

use App\Models\Post;
use Illuminate\Http\Request;

class PostController
{
    public function index()
    {
        $posts = Post::orderBy('created_at', 'desc')->get();
        return view('posts.index', compact('posts'));
    }

    public function store(Request $request)
    {
        $request->validate(['title' => 'required|string|max:255']);
        Post::create($request->only('title', 'body'));
        return redirect('/');
    }

    public function destroy(Post $post)
    {
        $post->delete();
        return redirect('/');
    }
}
