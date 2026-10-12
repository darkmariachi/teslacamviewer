using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TeslaCam.Data.Migrations
{
    /// <inheritdoc />
    public partial class ReasonValueAndMetaVersion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "MetaVersion",
                table: "Events",
                type: "INTEGER",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "ReasonValue",
                table: "Events",
                type: "REAL",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MetaVersion",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "ReasonValue",
                table: "Events");
        }
    }
}
