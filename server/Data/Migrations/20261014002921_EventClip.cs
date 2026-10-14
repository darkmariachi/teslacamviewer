using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaCam.Data.Migrations
{
    /// <inheritdoc />
    public partial class EventClip : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HasEventClip",
                table: "Events",
                type: "INTEGER",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "HasEventClip",
                table: "Events");
        }
    }
}
