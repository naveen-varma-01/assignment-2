const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')

const app = express()
app.use(express.json())

const dbpath = path.join(__dirname, 'twitterClone.db')
let db = null

const initializeDb = async () => {
  try {
    db = await open({
      filename: dbpath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () =>
      console.log('Server Running at http://localhost:3000/'),
    )
  } catch (e) {
    console.log(`DB Error:${e.message}`)
  }
}

initializeDb()

const authenticationToken = (request, response, next) => {
  const {tweet} = request.body
  const {tweetId} = request.params

  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'naveen', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.payload = payload
        request.tweetId = tweetId
        request.tweet = tweet
        next()
      }
    })
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body

  const checkUserQuery = `
    SELECT
    *
    FROM
    user
    WHERE
    username='${username}'`
  const dbUser = await db.get(checkUserQuery)
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400)
      response.send('Password is too short')
    } else {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `
        INSERT INTO
        user (username,password,name,gender)
        VALUES(
            '${username}',
            '${hashedPassword}',
            '${name}',
            '${gender}'
        );`
      await db.run(createUserQuery)
      response.send('User created successfully')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login', async (request, response) => {
  const {username, password} = request.body
  const selectUserQuery = `
  SELECT
    *
  FROM
    user
  WHERE
    username='${username}';`

  const dbUser = await db.get(selectUserQuery)
  if (dbUser === undefined) {
    response.status(400)
    response.send('Invalid user')
  } else {
    const isPassword = await bcrypt.compare(password, dbUser.password)
    if (isPassword === true) {
      const jwtToken = jwt.sign(dbUser, 'naveen')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  }
})

app.get(
  '/user/tweets/feed/',
  authenticationToken,
  async (request, response) => {
    const {payload} = request
    const {user_id, name, username, gender} = payload
    const getTweetsQuery = `
  SELECT
  username,tweet,date_time AS dateTime
  FROM
  follower
  INNER JOIN tweet
  ON follower.following_user_id=tweet.user_id
  INNER JOIN user
  ON user.user_id=follower.following_user_id
  WHERE
  follower.follower_user_id=${user_id}
  ORDER BY
  date_time DESC
  LIMIT 4;`
    const tweets = await db.all(getTweetsQuery)
    response.send(tweets)
  },
)

app.get('/user/following/', authenticationToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const getFollowsQuery = `
  SELECT
  name
  FROM
  user INNER JOIN follower ON user.user_id=follower.following_user_id
  WHERE
    follower.follower_user_id=${user_id};`
  const followingArray = await db.all(getFollowsQuery)
  response.send(followingArray)
})

app.get('/user/followers', authenticationToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const getFollowsQuery = `
  SELECT
  name
  FROM
  user INNER JOIN follower ON user.user_id=follower.follower_user_id
  WHERE
    follower.following_user_id=${user_id};`
  const followsArray = await db.all(getFollowsQuery)
  response.send(followsArray)
})

app.get('/tweets/:tweetId', authenticationToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const tweetsQuery = `
  SELECT * FROM tweet WHERE tweet_id=${tweetId};`
  const tweetResult = await db.get(tweetsQuery)
  const userFollowersQuery = `
  SELECT
    *
  FROM  follower INNER JOIN user ON user.user_id=follower.following_user_id
  WHERE
    follower.follower_user_id=${user_id};`
  const userFollowers = await db.all(userFollowersQuery)
  if (
    userFollowers.some(item => item.following_user_id === tweetResult.user_id)
  ) {
    console.log(tweetResult)
    console.log('----------')
    console.log(userFollowers)
    const getTweetDetailsQuery = `
    SELECT
    tweet,
    COUNT(DISTINCT(like.like_id)) AS likes,
    COUNT(DISTINCT(reply.reply_id)) AS replies,
    tweet.date_time AS dateTime
    FROM
    tweet INNER JOIN like ON tweet.tweet_id=like.tweet_id INNER JOIN reply ON reply.tweet_id=tweet.tweet_id
    WHERE
    tweet.tweet_id=${tweetId} AND tweet.user_id=${userFollowers[0].user_id};`
    const tweetDetails = await db.get(getTweetDetailsQuery)
    response.send(tweetDetails)
  } else {
    response.status(401)
    response.send('Invalid Request')
  }
})

app.get(
  '/tweets/:tweetId/likes',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request
    const {payload} = request
    const {user_id, name, username, gender} = payload
    const getLikedUsersQuery = `
  SELECT
  *
  FROM
  follower INNER JOIN tweet ON tweet.user_id=follower.following_user_id INNER JOIN like ON like.tweet_id=tweet.tweet_id
  INNER JOIN user ON user.user_id=like.user_id
  WHERE
  tweet.tweet_id=${tweetId} AND follower.follower_user_id=${user_id};`
    const likedUsers = await db.all(getLikedUsersQuery)
    if (likedUsers.length !== 0) {
      let likes = []
      const getNamesArray = likedUsers => {
        for (let item of likedUsers) {
          likes.push(item.username)
        }
      }
      getNamesArray(likedUsers)
      response.send({likes})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get(
  '/tweets/:tweetId/replies',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request
    const {payload} = request
    const {user_id, name, username, gender} = payload
    const getRepliedUserQuery = `
  SELECT
  *
  FROM
  follower INNER JOIN tweet ON tweet.user_id=follower.following_user_id INNER JOIN reply ON reply.tweet_id=tweet.tweet_id
  WHERE
  tweet.tweet_id=${tweetId} AND follower.follower_user_id=${user_id};`
    const repliedUsers = await db.all(getRepliedUserQuery)
    if (repliedUsers.length !== 0) {
      let replies = []
      const getNamesArray = repliedUsers => {
        for (let item of repliedUsers) {
          let object = {
            name: item.name,
            reply: item.reply,
          }
          replies.push(object)
        }
      }
      getNamesArray(repliedUsers)
      response.send({replies})
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)

app.get('/user/tweets', authenticationToken, async (request, response) => {
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const getTweetsDetailsQuery = `
  SELECT
  tweet.tweet AS tweet,
  COUNT(DISTINCT(like.like_id)) AS likes,
  COUNT(DISTINCT(reply.reply_id)) AS replies,
  tweet.date_time AS dateTime
  FROM
  user INNER JOIN tweet ON user.user_id=tweet.user_id INNER JOIN like ON like.tweet_id=tweet.tweet_id INNER JOIN reply ON reply.tweet_id=tweet.tweet_id
  WHERE
  user.user_id=${user_id}
  GROUP BY
  tweet.tweet_id;`
  const tweetDetails = await db.all(getTweetsDetailsQuery)
  response.send(tweetDetails)
})

app.post('/user/tweets', authenticationToken, async (request, response) => {
  const {tweet} = request
  const {tweetId} = request
  const {payload} = request
  const {user_id, name, username, gender} = payload
  const postTweetQuery = `
  INSERT INTO
  tweet (tweet,user_id)
  VALUES(
    '${tweet}',
    ${user_id}
  );`
  await db.run(postTweetQuery)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId',
  authenticationToken,
  async (request, response) => {
    const {tweetId} = request
    const {payload} = request
    const {user_id, name, username, gender} = payload
    const selectUserQuery = `
  SELECT
  *
  FROM
  tweet
  WHERE
  tweet.user_id=${user_id} AND tweet.tweet_id=${tweetId};`
    const tweetUser = await db.all(selectUserQuery)
    if (tweetUser !== 0) {
      const deleteQuery = `
    DELETE FROM tweet
    WHERE
    tweet.user_id=${user_id} AND tweet.tweet_id=${tweetId};`
      await db.run(deleteQuery)
      response.send('Tweet Removed')
    } else {
      response.status(401)
      response.send('Invalid Request')
    }
  },
)
module.exports = app
