const { defineConfig } = require("@medusajs/framework/utils");

module.exports = defineConfig({
	projectConfig: {
		databaseUrl: process.env.DATABASE_URL,
		http: {
			storeCors: "http://localhost:4321",
			adminCors: "http://localhost:19000",
			authCors: "http://localhost:19000",
			jwtSecret: process.env.JWT_SECRET,
			cookieSecret: process.env.COOKIE_SECRET,
		},
	},
	admin: {
		disable: true,
	},
});
