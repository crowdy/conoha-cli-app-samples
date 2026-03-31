import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Post } from "./post.entity";

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private readonly repo: Repository<Post>,
  ) {}

  findAll(): Promise<Post[]> {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }

  create(title: string, body: string): Promise<Post> {
    const post = this.repo.create({ title, body });
    return this.repo.save(post);
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
  }
}
