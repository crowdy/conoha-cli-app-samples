CREATE TABLE "rich_menu_images" (
	"rich_menu_id" integer PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rich_menus" (
	"id" serial PRIMARY KEY NOT NULL,
	"rich_menu_id" text NOT NULL,
	"channel_id" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rich_menus_rich_menu_id_unique" UNIQUE("rich_menu_id")
);
--> statement-breakpoint
CREATE TABLE "user_rich_menu_links" (
	"channel_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"rich_menu_id" integer NOT NULL,
	CONSTRAINT "user_rich_menu_links_channel_id_user_id_pk" PRIMARY KEY("channel_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "default_rich_menu_id" integer;--> statement-breakpoint
ALTER TABLE "rich_menu_images" ADD CONSTRAINT "rich_menu_images_rich_menu_id_rich_menus_id_fk" FOREIGN KEY ("rich_menu_id") REFERENCES "public"."rich_menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rich_menus" ADD CONSTRAINT "rich_menus_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rich_menu_links" ADD CONSTRAINT "user_rich_menu_links_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rich_menu_links" ADD CONSTRAINT "user_rich_menu_links_user_id_virtual_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."virtual_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rich_menu_links" ADD CONSTRAINT "user_rich_menu_links_rich_menu_id_rich_menus_id_fk" FOREIGN KEY ("rich_menu_id") REFERENCES "public"."rich_menus"("id") ON DELETE cascade ON UPDATE no action;