using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaCam.Data.Migrations
{
    /// <inheritdoc />
    public partial class ArchiverHealth : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "LastLogJson",
                table: "ArchiverSessions",
                type: "TEXT",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ArchiverSamples",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    SessionId = table.Column<int>(type: "INTEGER", nullable: false),
                    At = table.Column<DateTime>(type: "TEXT", nullable: false),
                    CpuTempC = table.Column<double>(type: "REAL", nullable: true),
                    SupplyVolts = table.Column<double>(type: "REAL", nullable: true),
                    WifiStrength = table.Column<double>(type: "REAL", nullable: true),
                    Throttled = table.Column<int>(type: "INTEGER", nullable: true),
                    FreeBytes = table.Column<long>(type: "INTEGER", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArchiverSamples", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ArchiverSamples_At",
                table: "ArchiverSamples",
                column: "At");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ArchiverSamples");

            migrationBuilder.DropColumn(
                name: "LastLogJson",
                table: "ArchiverSessions");
        }
    }
}
