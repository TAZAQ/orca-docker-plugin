import type { PruneMode, PrunePreview } from '../shared/protocol'
import type { DockerContainer, DockerImage } from './docker-api'
import { toTreeImage } from './docker-tree'

/** The destructive side of images, kept apart so its checks are easy to see. */

type ImagesApi = {
  listContainers(): Promise<DockerContainer[]>
  listImages(): Promise<DockerImage[]>
  forceRemoveContainer(id: string): Promise<void>
  removeImage(id: string): Promise<void>
}

function isDangling(image: DockerImage): boolean {
  return toTreeImage(image).tags.length === 0
}

/** Mirrors what the daemon's prune takes: nothing a container uses, even a stopped one. */
export function pruneCandidates(
  images: DockerImage[],
  containers: DockerContainer[],
  mode: PruneMode
): DockerImage[] {
  const used = new Set(containers.map((container) => container.ImageID))
  return images.filter((image) => !used.has(image.Id) && (mode === 'unused' || isDangling(image)))
}

export async function previewPrune(
  docker: Pick<ImagesApi, 'listContainers' | 'listImages'>,
  mode: PruneMode
): Promise<PrunePreview> {
  const [images, containers] = await Promise.all([docker.listImages(), docker.listContainers()])
  return {
    images: pruneCandidates(images, containers, mode).map((image) => ({
      name: toTreeImage(image).name,
      size: image.Size
    }))
  }
}

/** Refuses when a container appeared or went since the person agreed: they saw another list. */
export async function removeImageWithContainers(
  docker: ImagesApi,
  imageId: string,
  agreedContainerIds: string[]
): Promise<void> {
  const current = (await docker.listContainers())
    .filter((container) => container.ImageID === imageId)
    .map((container) => container.Id)
  const agreed = new Set(agreedContainerIds)
  if (current.length !== agreed.size || current.some((id) => !agreed.has(id))) {
    throw Object.assign(new Error('The containers of this image changed. Look at the list again.'), {
      code: 'conflict'
    })
  }
  for (const id of current) {
    await docker.forceRemoveContainer(id)
  }
  await docker.removeImage(imageId)
}
