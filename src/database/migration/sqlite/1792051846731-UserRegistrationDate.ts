/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MigrationInterface, QueryRunner } from "typeorm";

const hasRegistrationDate = async (queryRunner: QueryRunner) => {
    const columns: { name: string }[] = await queryRunner.query(`PRAGMA table_info("users")`);
    return columns.some((column) => column.name === "registration_date");
};

export class UserRegistrationDate1792051846731 implements MigrationInterface {
    name = "UserRegistrationDate1792051846731";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasRegistrationDate(queryRunner))) await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "registration_date" datetime`);
        await queryRunner.query(`UPDATE "users" SET "registration_date" = "created_at" WHERE "registration_date" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasRegistrationDate(queryRunner)) await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "registration_date"`);
    }
}
