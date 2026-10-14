using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaCam.Data.Migrations
{
    /// <inheritdoc />
    public partial class Archiver : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ArchiverSessions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Open = table.Column<bool>(type: "INTEGER", nullable: false),
                    LastStatusJson = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArchiverSessions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ArchiverSyncs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    StartedAt = table.Column<DateTime>(type: "TEXT", nullable: false),
                    FinishedAt = table.Column<DateTime>(type: "TEXT", nullable: true),
                    FilesPlanned = table.Column<int>(type: "INTEGER", nullable: true),
                    EventsPlanned = table.Column<int>(type: "INTEGER", nullable: true),
                    FilesArchived = table.Column<int>(type: "INTEGER", nullable: true),
                    Message = table.Column<string>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ArchiverSyncs", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ArchiverSessions");

            migrationBuilder.DropTable(
                name: "ArchiverSyncs");
        }
    }
}
