const octokit = require('@octokit/rest')()
const got = require('got')
const lockfile = require('@yarnpkg/lockfile')

const CLOSED = 'closed'

const API = 'https://registry.npmjs.org/-/package/{package}/dist-tags'

const REVIEW_BRANCH = 'heads/update-dependencies'
const MASTER_BRANCH = 'heads/master'
const COMMITTER = {
  'name': 'Automatiz',
  'email': 'josemanuel.rosamoncayo+automatiz@gmail.com',
  'date': new Date()
}

const PR_TITLE = 'Update dependencies to the latest version'
const PR_BODY = 'Update dependencies for package.json'
const COMMIT_MESSAGE = 'fix(packages): update dependencies for package.json'
const PACKAGE = 'package.json'
const LABEL = 'update-dependency'

const auth = TOKEN => {
  try {
    return octokit.authenticate({
      type: 'oauth',
      token: TOKEN
    })
  } catch (err) {
    console.log(err)
    throw err
  }
}

const generatedBranch = () => REVIEW_BRANCH.split('/')[1]

const getBranch = async ({ owner, repo }, fromMaster = false) => {
  let branch = REVIEW_BRANCH
  if (fromMaster) {
    branch = MASTER_BRANCH
  }

  try {
    return (await octokit.gitdata.getRef({
      owner,
      repo,
      ref: branch
    })).data.object.sha
  } catch (err) {
    throw err
  }
}

const createCommit = async ({ owner, repo }, data, prevCommitSha) => {
  try {
    const shaBaseTree = (await octokit.gitdata.getCommit({
      owner,
      repo,
      commit_sha: prevCommitSha
    })).data.tree.sha

    const shaBlob = (await octokit.gitdata.createBlob({
      owner,
      repo,
      content: JSON.stringify(data, undefined, 2),
      encoding: 'utf-8'
    })).data.sha

    const shaNewTree = (await octokit.gitdata.createTree({
      owner,
      repo,
      tree: [{
        path: PACKAGE,
        mode: '100644',
        type: 'blob',
        sha: shaBlob
      }],
      base_tree: shaBaseTree
    })).data.sha

    return (await octokit.gitdata.createCommit({
      owner,
      repo,
      message: `${COMMIT_MESSAGE} ${(new Date()).getTime()}`,
      tree: shaNewTree,
      parents: [prevCommitSha],
      committer: COMMITTER
    })).data.sha
  } catch (err) {
    throw err
  }
}

const updatePR = async ({ owner, repo }, sha) => {
  try {
    const branch = await octokit.pullRequests.list({
      owner,
      repo,
      state: 'open',
      base: generatedBranch()
    })

    if (!branch.data.length) {
      throw new Error('PR dont exist')
    }

    return branch
  } catch (err) {
    throw err
  }
}

const createBranch = async ({ owner, repo }, commitSha) => {
  try {
    return await octokit.gitdata.createRef({
      owner,
      repo,
      ref: `refs/${REVIEW_BRANCH}`,
      sha: commitSha
    })
  } catch (err) {
    throw err
  }
}

const updateBranch = async ({ owner, repo }, commitSha) => {
  try {
    return await octokit.gitdata.updateRef({
      owner,
      repo,
      ref: REVIEW_BRANCH,
      sha: commitSha
    })
  } catch (err) {
    throw err
  }
}

const createPR = async ({ owner, repo }, commitSha) => {
  try {
    const pr = await octokit.pullRequests.create({
      owner,
      repo,
      title: PR_TITLE,
      head: `refs/${REVIEW_BRANCH}`,
      base: 'master',
      body: PR_BODY
    })

    return await octokit.issues.addLabels({
      owner,
      repo,
      number: pr.data.number,
      labels: [LABEL]
    })
  } catch (err) {
    throw err
  }
}

const getFile = async ({ owner, repo }, path) => {
  try {
    const response = await octokit.repos.getContents({
      owner,
      repo,
      path,
      ref: MASTER_BRANCH
    })

    return Buffer.from(response.data.content, 'base64').toString()
  } catch (err) {
    throw new Error(`Dont find ${path} in repository`)
  }
}

const findPackage = (acc, pkg, lock, original) => {
  acc.push({ package: pkg, version: lock.version })

  return acc
}

const getLatestVersion = async (dependencies, base) => (await Promise.all(
  dependencies.map(item => got.get(
    API.replace('{package}', item.package),
    { json: true }
  ))
))
  .reduce((acc, item, index) => {
    if (dependencies[index].version !== item.body.latest) {
      acc[item.requestUrl.split('/')[5]] = `^${item.body.latest}`
    }

    return acc
  }, [])

module.exports = async function ({ data, body }, done) {
  console.log(data, body)
  // eslint-disable-next-line camelcase
  const { repository, pull_request } = body
  const { owner: { login }, name } = repository

  const access = { owner: login, repo: name }

  let lock
  let pkg
  let dependencies
  let devDependencies

  if (
    // body.action === CLOSED &&
    pull_request.head.ref === generatedBranch()
  ) {
    await auth(data.GITHUB_TOKEN)

    try {
      pkg = JSON.parse(await getFile(access, 'package.json'))
    } catch (err) {
      done(err)
    }
    console.log('here')
    try {
      console.log(':: package-lock.json')

      lock = JSON.parse(await getFile(access, 'package-lock.json'))
      lock = lock.dependencies

      dependencies = Object.keys(pkg.dependencies).reduce(
        (acc, module) => findPackage(acc, module, lock[module], pkg.dependencies[module]),
        []
      )

      devDependencies = Object.keys(pkg.devDependencies).reduce(
        (acc, module) => findPackage(acc, module, lock[module], pkg.devDependencies[module]),
        []
      )
    } catch (err) {
      console.log(':: yarn.lock')
      lock = lockfile.parse(await getFile(access, 'yarn.lock'))
      lock = lock.object

      dependencies = Object.keys(pkg.dependencies).reduce(
        (acc, module) => findPackage(
          acc,
          module,
          lock[Object.keys(lock).find(key => key.startsWith(`${module}@`))],
          pkg.dependencies[module]
        ),
        []
      )

      devDependencies = Object.keys(pkg.devDependencies).reduce(
        (acc, module) => findPackage(
          acc,
          module,
          lock[Object.keys(lock).find(key => key.startsWith(`${module}@`))],
          pkg.devDependencies[module]
        ),
        []
      )
    }

    dependencies = await getLatestVersion(dependencies, pkg.dependencies)
    devDependencies = await getLatestVersion(devDependencies, pkg.devDependencies)

    if (!Object.keys(dependencies).length && !Object.keys(devDependencies).length) {
      done(null, { result: 'There aren\'t new versions' })
    }

    const newPackage = {
      ...pkg,
      dependencies: {
        ...pkg.dependencies,
        ...dependencies
      },
      devDependencies: {
        ...pkg.devDependencies,
        ...devDependencies
      }
    }

    let latsCommitInBranch
    let newCommitSha
    try {
      latsCommitInBranch = await getBranch(access)
      newCommitSha = await createCommit(access, newPackage, latsCommitInBranch)
      await updateBranch(access, newCommitSha)
      try {
        await updatePR(newCommitSha)
      } catch (e) {
        await createPR(newCommitSha)
      }
    } catch (err) {
      if (err.code === 404) {
        latsCommitInBranch = await getBranch(true)
        newCommitSha = await createCommit(newPackage, latsCommitInBranch)
        await createBranch(newCommitSha)
        await createPR(newCommitSha)
      }
    }
  }

  done(null, { result: 'Updater Hook Success!' })
}
