CREATE TABLE "rich_menu_aliases" (
	"channel_id" integer NOT NULL,
	"alias_id" text NOT NULL,
	"rich_menu_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rich_menu_aliases_channel_id_alias_id_pk" PRIMARY KEY("channel_id","alias_id")
);
--> statement-breakpoint
ALTER TABLE "rich_menu_aliases" ADD CONSTRAINT "rich_menu_aliases_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rich_menu_aliases" ADD CONSTRAINT "rich_menu_aliases_rich_menu_id_rich_menus_id_fk" FOREIGN KEY ("rich_menu_id") REFERENCES "public"."rich_menus"("id") ON DELETE cascade ON UPDATE no action;