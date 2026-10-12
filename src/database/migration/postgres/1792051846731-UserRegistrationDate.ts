/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MigrationInterface, QueryRunner } from "typeorm";

export class UserRegistrationDate1792051846731 implements MigrationInterface {
    name = "UserRegistrationDate1792051846731";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "registration_date" timestamp`);
        await queryRunner.query(`UPDATE "users" SET "registration_date" = "created_at" WHERE "registration_date" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "registration_date"`);
    }
}
