CREATE TABLE "price_history_cache" (
	"symbol" text NOT NULL,
	"range" text NOT NULL,
	"points" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_cache_symbol_range_pk" PRIMARY KEY("symbol","range")
);
