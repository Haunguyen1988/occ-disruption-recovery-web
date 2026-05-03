import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://occ-disruption-recovery.vercel.app',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://occ-disruption-recovery.vercel.app/dashboard',
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 0.8,
    },
  ]
}
