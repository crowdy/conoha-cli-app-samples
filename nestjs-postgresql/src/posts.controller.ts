import { Body, Controller, Get, Post as HttpPost, Param, Render, Redirect } from "@nestjs/common";
import { PostsService } from "./posts.service";

@Controller()
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  @Render("index")
  async index() {
    const posts = await this.postsService.findAll();
    return { posts };
  }

  @HttpPost("posts")
  @Redirect("/")
  async create(@Body() body: { title: string; body: string }) {
    await this.postsService.create(body.title, body.body);
  }

  @HttpPost("posts/:id/delete")
  @Redirect("/")
  async remove(@Param("id") id: string) {
    await this.postsService.remove(Number(id));
  }
}
