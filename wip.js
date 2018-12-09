const octokit = require('@octokit/rest')()

const WIP_CHECK = ['labeled', 'unlabeled', 'edited']
const WIP = ['\\(wip\\)', '\\[wip\\]', 'wip', 'work\\s*in\\s*progress']

const GIT_CONFIG = {
  STATUS_MESSAGE: 'This branch is in a work in progress, then you can not merge it',
  STATUS_CONTEXT: 'Work in progress branch'
}

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

const createStatus = ({ owner, repo }, commitSha, isInWorkInProgress) => {
  try {
    return octokit.repos.createStatus({
      owner,
      repo,
      // eslint-disable-next-line camelcase
      sha: commitSha,
      state: isInWorkInProgress ? 'error' : 'success',
      description: GIT_CONFIG.STATUS_MESSAGE,
      context: GIT_CONFIG.STATUS_CONTEXT
    })
  } catch (err) {
    console.log(err)
    throw err
  }
}

module.exports = async function ({ data, body }, done) {
  // eslint-disable-next-line camelcase
  const { repository, pull_request } = body
  const { owner: { login }, name } = repository

  try {
    if (WIP_CHECK.includes(body.action)) {
      const exps = new RegExp(WIP.join('|'), 'gi')

      const pr = pull_request.labels
        .map(item => item.name)
        .concat(pull_request.title)

      const isInWorkInProgress = pr.some(text => exps.test(text))

      await auth(data.GITHUB_TOKEN)

      await createStatus(
        { owner: login, repo: name },
        pull_request.head.sha,
        isInWorkInProgress
      )
    }

    done(null, { result: 'WIP hook Success' })
  } catch (err) {
    console.log('err', err)
    done(err)
  }
}
