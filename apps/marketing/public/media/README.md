# Demo video & photo

The "See it in action" section's media strip ([components/media-strip.tsx](../../components/media-strip.tsx))
looks for these optional files. Until they exist, branded placeholders show instead
(so nothing breaks):

| File | What it is |
|------|------------|
| `demo.mp4`        | Short looping product demo (muted, autoplay). WebM also fine — update the `src`. |
| `demo-poster.jpg` | Poster frame shown before the video plays |
| `team.jpg`        | A team / lifestyle photo |

**Licensing:** use your own footage/photos or properly-licensed stock (Unsplash,
Pexels for free-to-use; or a paid library). Don't drop in images you don't have
rights to publish.
