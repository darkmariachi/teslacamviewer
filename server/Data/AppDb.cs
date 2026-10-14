using Microsoft.EntityFrameworkCore;

namespace TeslaCam.Data;

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<Event> Events => Set<Event>();
    public DbSet<Segment> Segments => Set<Segment>();
    public DbSet<ClipFile> ClipFiles => Set<ClipFile>();
    public DbSet<Job> Jobs => Set<Job>();
    public DbSet<Collection> Collections => Set<Collection>();
    public DbSet<CollectionEvent> CollectionEvents => Set<CollectionEvent>();
    public DbSet<Setting> Settings => Set<Setting>();
    public DbSet<ArchiverSession> ArchiverSessions => Set<ArchiverSession>();
    public DbSet<ArchiverSync> ArchiverSyncs => Set<ArchiverSync>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Event>(e =>
        {
            e.HasIndex(x => new { x.Type, x.Name, x.RelPath });
            e.HasIndex(x => x.StartTime);
            e.HasIndex(x => x.TrashedAt);
            e.Property(x => x.Type).HasConversion<string>();
        });
        b.Entity<Segment>(e =>
        {
            e.HasOne(x => x.Event).WithMany(x => x.Segments).HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.EventId, x.Index });
        });
        b.Entity<ClipFile>(e =>
        {
            e.HasOne(x => x.Segment).WithMany(x => x.Files).HasForeignKey(x => x.SegmentId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Job>(e =>
        {
            e.HasOne(x => x.Event).WithMany().HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => new { x.Status, x.Priority });
            e.HasIndex(x => new { x.EventId, x.Kind });
            e.Property(x => x.Kind).HasConversion<string>();
            e.Property(x => x.Status).HasConversion<string>();
        });
        b.Entity<Collection>(e => e.HasIndex(x => x.Name).IsUnique());
        b.Entity<CollectionEvent>(e =>
        {
            e.HasKey(x => new { x.CollectionId, x.EventId });
            e.HasOne(x => x.Collection).WithMany(x => x.Events).HasForeignKey(x => x.CollectionId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne(x => x.Event).WithMany(x => x.Collections).HasForeignKey(x => x.EventId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Setting>(e => e.HasKey(x => x.Key));
    }
}
