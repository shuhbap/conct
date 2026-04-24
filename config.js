import dotenv from "dotenv";
import fs from "fs-extra";

if (fs.existsSync("config.env")) {
	dotenv.config({
		path: "./config.env"
	});
}

const config = {
	MONGODB_URI: process.env.MONGODB_URI || "mongodb+srv://gsdvsbotnew:@ABHI903778cluster0.juvwkhf.mongodb.net/", // put your mongo db url
};

export default config;
