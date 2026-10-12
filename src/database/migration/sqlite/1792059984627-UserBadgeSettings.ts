/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MigrationInterface, QueryRunner } from "typeorm";

const hasBadgeSettings = async (queryRunner: QueryRunner) => {
    const columns: { name: string }[] = await queryRunner.query(`PRAGMA table_info("users")`);
    return columns.some((column) => column.name === "badge_settings");
};

export class UserBadgeSettings1792059984627 implements MigrationInterface {
    name = "UserBadgeSettings1792059984627";

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await hasBadgeSettings(queryRunner))) await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "badge_settings" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await hasBadgeSettings(queryRunner)) await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "badge_settings"`);
    }
}
