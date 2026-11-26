using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaCam.Data.Migrations
{
    /// <inheritdoc />
    public partial class DriveData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DriveDataVersion",
                table: "Events",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "EndCity",
                table: "Events",
                type: "TEXT",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "EndLat",
                table: "Events",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "EndLon",
                table: "Events",
                type: "REAL",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "HasDriveData",
                table: "Events",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "EventTracks",
                columns: table => new
                {
                    EventId = table.Column<int>(type: "INTEGER", nullable: false),
                    Points = table.Column<string>(type: "TEXT", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EventTracks", x => x.EventId);
                    table.ForeignKey(
                        name: "FK_EventTracks_Events_EventId",
                        column: x => x.EventId,
                        principalTable: "Events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EventTracks");

            migrationBuilder.DropColumn(
                name: "DriveDataVersion",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "EndCity",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "EndLat",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "EndLon",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "HasDriveData",
                table: "Events");
        }
    }
}
