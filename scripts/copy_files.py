import os
import shutil

targets = [
  './zkopru/packages/babyjubjub/dist/types',
  './zkopru/packages/contracts/dist/contracts'
]

for target in targets:
  if not os.path.exists(target):
    os.makedirs(target)

  shutil.copytree(target.replace('dist', 'src'), target, dirs_exist_ok=True)
