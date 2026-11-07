using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaCam.Data.Migrations
{
    /// <inheritdoc />
    public partial class CarReadings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CarReadings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    CarTime = table.Column<DateTime>(type: "TEXT", nullable: true),
                    CarTimeEstimated = table.Column<bool>(type: "INTEGER", nullable: false),
                    PiTime = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Mode = table.Column<string>(type: "TEXT", nullable: false),
                    Data = table.Column<string>(type: "TEXT", nullable: false),
                    Source = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CarReadings", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CarReadings_Kind_CarTime",
                table: "CarReadings",
                columns: new[] { "Kind", "CarTime" });

            migrationBuilder.CreateIndex(
                name: "IX_CarReadings_Source",
                table: "CarReadings",
                column: "Source",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CarReadings");
        }
    }
}
