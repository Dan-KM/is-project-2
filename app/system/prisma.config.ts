import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./src/prisma/contract.prisma",
    db: {
      connection: process.env['MIGRATION_DATABASE_URL']!,
    },
  }),
});


// app/system/prisma.config.ts — read by every `npx prisma ...` command
// import "dotenv/config"; // loads app/system/.env into process.env
// import { definePrismaConfig } from "prisma/config";
// import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

// export default definePrismaConfig({
//   orm: ormConfig({
//     // Where your models live; contract emit writes contract.json/.d.ts beside it
//     contract: "./src/prisma/contract.prisma",
//     db: {
//       // CLI uses the OWNER role: it needs to read structure and create the marker table
//       connection: process.env["MIGRATION_DATABASE_URL"]!,
//     },
//   }),
// });