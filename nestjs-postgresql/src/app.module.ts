import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "./post.entity";
import { PostsController } from "./posts.controller";
import { PostsService } from "./posts.service";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "db",
      port: 5432,
      username: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "postgres",
      database: process.env.DB_NAME || "app_production",
      entities: [Post],
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Post]),
  ],
  controllers: [PostsController],
  providers: [PostsService],
})
export class AppModule {}
