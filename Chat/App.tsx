import _ from "lodash";
import moment from "moment";
import * as React from "react";
import { withCookies } from "react-cookie";
import { connect } from "react-redux";
import { Route, RouteComponentProps, withRouter } from "react-router-dom";
import "./App.css";
import ChatPage from "./components/ChatPage/ChatPage";
import TrackPage from "./components/Common/Mixpanel/TrackPage/TrackPage";
import ErrorPage from "./components/ErrorPage/ErrorPage";
import ProjectPage from "./components/ProjectPage/ProjectPage";
import SearchPage from "./components/SearchPage/SearchPage";
import SettingsPage from "./components/SettingsPage/SettingsPage";
import * as config from "./config";
import { appName, routes } from "./constants";
import { PAGES } from "./constants/mixpanel";
import {
  addMessage,
  addProject,
  getHistory,
  getProjects,
  getSettings,
  getUnreads,
  saveProjectOffset,
  setAuthInfo,
  setProjectHistoryAwait,
  updateLastMessage,
} from "./store/actions";
import {
  DELETE_PROJECT,
  IAuthInfoState,
  IChatState,
  IProjectCustomFields,
  IProjectState,
  IRenderAwaitState,
  SET_ROCKET_CLIENT,
  SET_ROCKET_CONNECT_STATE,
  UPDATE_UNREAD,
} from "./store/definitions";
import Mixpanel from "./util/mixpanel";
import { sendNotification } from "./util/notification";
import { Recorder } from "./util/recorder";
import { generateHash } from "./util/rocketchat/helper";
import { MethodCallApi } from "./util/rocketchat/methodCallApi";
import { RocketClient } from "./util/rocketchat/rocketClient";
import { SubscriptionApi } from "./util/rocketchat/subscriptionApi";
import {
  IRocketEventHandler,
  IRoom,
  RocketConnectState,
} from "./util/rocketchat/types";
import { getWindowInfo, sortTimeByNewest } from "./util/utils";
import { wordings } from "./wordings/Wordings";

enum INIT_STATE {
  IDLE,
  LOADING_CACHE,
  LOADED_CACHE,
  LOADING_FRESH,
  LOADED_FRESH,
}
// tslint:disable
declare global {
  interface Window {
    KPIdata: any;
  }
}
// tslint:enable

interface IAppProps extends RouteComponentProps<any> {
  authInfo: IAuthInfoState;
  rocketConnectState: RocketConnectState;
  cookies?: any;
  chat: IChatState;
  project: IProjectState;
  renderAwait: IRenderAwaitState;
  setRocketClientInfo: (rocketClient: RocketClient) => void;
  setRocketConnectState: (state: RocketConnectState) => void;
  setAuthInfo: (
    rocketAccess: string,
    username: string,
    displayName: string,
    userid: string,
  ) => void;
  getProjects: (rooms: IRoom[], customFields: IProjectCustomFields) => void;
  getUnreads: (rooms: any) => void;
  addProject: (room: IRoom, customFields: IProjectCustomFields) => void;
  getHistory: (message: any, roomId: string) => void;
  addMessage: (newMessage: string) => void;
  updateUnread: (roomId: string, unread: number) => void;
  updateLastMessage: (message: any) => void;
  deleteProject: (roomId: string) => void;
  setProjectHistoryAwait: () => void;
  saveProjectOffset: (offset: number) => void;
  getSettings: (settings: any) => void;
}

const mapStateToProps = (state: any, ownProps: any) => ({
  authInfo: state.authInfo,
  chat: state.chat,
  cookies: ownProps.cookies,
  project: state.project,
  renderAwait: state.renderAwait,
  rocketConnectState: state.rocket.rocketConnectState,
});

const mapDispatchToProps = (dispatch: any) => ({
  addMessage: (newMessage: string) => addMessage(dispatch, newMessage),
  addProject: (room: IRoom, customFields: IProjectCustomFields) =>
    addProject(dispatch, room, customFields),
  deleteProject: (roomId: string) => {
    dispatch({
      payload: {
        id: roomId,
      },
      type: DELETE_PROJECT,
    });
  },
  getHistory: (messages: any, roomId: string) =>
    getHistory(dispatch, messages, roomId),
  getProjects: (rooms: IRoom[], customFields: IProjectCustomFields) =>
    getProjects(dispatch, rooms, customFields),
  getSettings: (settings: any) => getSettings(dispatch, settings),
  getUnreads: (rooms: any) => getUnreads(dispatch, rooms),
  saveProjectOffset: (offset: number) => saveProjectOffset(dispatch, offset),
  setAuthInfo: (
    rocketAccess: string,
    username: string,
    displayName: string,
    userid: string,
  ) => {
    setAuthInfo(dispatch, rocketAccess, username, displayName, userid);
  },
  setProjectHistoryAwait: () => setProjectHistoryAwait(dispatch),
  setRocketClientInfo: (rocketClient: RocketClient) => {
    dispatch({
      payload: rocketClient,
      type: SET_ROCKET_CLIENT,
    });
  },
  setRocketConnectState: (state: RocketConnectState) => {
    dispatch({
      payload: state,
      type: SET_ROCKET_CONNECT_STATE,
    });
  },
  updateLastMessage: (message: any) => {
    updateLastMessage(dispatch, message);
  },
  updateUnread: (roomId: string, unread: number) => {
    dispatch({
      payload: {
        projectId: roomId,
        unread,
      },
      type: UPDATE_UNREAD,
    });
  },
});

class App extends React.Component<IAppProps, any> {
  private initState: INIT_STATE = INIT_STATE.IDLE;
  private recorder: Recorder;
  private rocketClient!: RocketClient;
  private rocketMethodCall!: MethodCallApi;
  private rocketSubscribe!: SubscriptionApi;
  private loggedIn = false;

  constructor(props: any) {
    super(props);
    this.recorder = new Recorder();
    const { isIPhoneX } = getWindowInfo();

    this.state = {
      isIPhoneX,
      projectLoaded: false,
    };
  }

  public componentWillMount() {
    this.loginAndConnect();
    this.props.saveProjectOffset(0);
  }
  public componentDidMount() {
    if (window && window.KPIdata) {
      Mixpanel.trackLoad(window.KPIdata);
    }
  }
  public shouldComponentUpdate(nextProps: IAppProps, nextState: any) {
    return (
      !nextProps.renderAwait.projectHistory.await ||
      this.props.location !== nextProps.location
    );
  }

  public render() {
    const bottomForIphone = this.state.isIPhoneX ? "iphone-margin-bottom" : "";
    return (
      <>
        <>
          <Route
            path={`${appName}`}
            exact={true}
            render={this.renderProjectPage}
          />
          <Route
            path={`${routes.projectList}`}
            render={this.renderProjectPage}
          />
          <Route
            path={`${routes.chat}/:projectId`}
            render={this.renderChatPage}
          />
          <Route
            path={`${routes.error}/:errorCode`}
            render={this.renderErrorCode}
          />
          <Route
            path={`${routes.search}`}
            exact={true}
            render={this.renderSearchPage}
          />
          <Route
            path={`${routes.search}/:projectId`}
            render={this.renderSearchPage}
          />
          <Route path={`${routes.settings}`} render={this.renderSettingsPage} />
        </>
        {this.props.rocketConnectState !== RocketConnectState.LoggedIn &&
          this.rocketClient &&
          this.rocketClient.ReconnectCount > 1 && (
            <div className={`info ${bottomForIphone}`}>
              {wordings.currentLang.reconnecting}
            </div>
          )}
        {this.renderInfo()}
      </>
    );
  }

  private renderErrorCode = (): JSX.Element => {
    return <ErrorPage />;
  }

  private renderSearchPage = (): JSX.Element => {
    return (
      <SearchPage
        myDisplayName={this.props.authInfo.displayName}
        userId={this.props.authInfo.userid}
        authToken={this.props.authInfo.rocketAccess}
      />
    );
  }

  private renderProjectPage = (): JSX.Element => {
    const { customFields } = this.props.project;

    const projectsWithoutSoftclosed = this.props.project.projects.filter(
      (group: any) => {
        const customField = customFields[group.id];
        return customField &&
          !customField.projectAccepted &&
          customField.softclose
          ? moment().isBefore(moment(customField.softclose), "day")
          : true;
      },
    );

    const projectsData = projectsWithoutSoftclosed.map((project) => {
      return {
        ...project,
        unread: this.props.project.unread[project.id],
      };
    });

    const [projectsWithUnread, projectsWithoutUnread] = _.partition(
      projectsData,
      (project) => project.unread,
    );

    const projects = [
      ...sortTimeByNewest(projectsWithUnread),
      ...sortTimeByNewest(projectsWithoutUnread),
    ];

    return (
      <>
        <TrackPage page={PAGES.PROJECT} />
        <ProjectPage
          unreads={this.props.project.unread}
          projects={projects}
          loaded={this.state.projectLoaded}
          myDisplayName={this.props.authInfo.displayName}
        />
      </>
    );
  }

  private renderChatPage = (): JSX.Element => {
    const { customFields } = this.props.project;
    const chatRoomId = this.getRoomIdFromPath();
    const project = this.props.project.projects.find((e) => {
      return e.id === chatRoomId;
    });
    let totalUnread = 0;

    if (Object.keys(this.props.project.unread).length) {
      totalUnread = Object.keys(this.props.project.unread).reduce(
        (sum: any, key: any) => {
          const customField = customFields[key];
          const include =
            customField && !customField.projectAccepted && customField.softclose
              ? moment().isBefore(moment(customField.softclose), "day")
              : true;
          return include ? sum + this.props.project.unread[key] : sum;
        },
        0,
      );
    }
    const messageArray = this.props.chat.chats[chatRoomId] || [];
    return (
      <>
        <TrackPage
          page={PAGES.CHAT}
          projectId={chatRoomId}
          projectName={project ? project.roomName : ""}
        />
        <ChatPage
          myDisplayName={this.props.authInfo.displayName}
          currentUserId={this.props.authInfo.userid}
          chat={messageArray}
          rocketClient={this.rocketClient}
          rocketMethodCall={this.rocketMethodCall}
          rocketSubscription={this.rocketSubscribe}
          projectName={project ? project.roomName : ""}
          unread={totalUnread}
          currentRead={this.props.project.unread[chatRoomId]}
          searchResult={[]}
          recorder={this.recorder}
        />
      </>
    );
  }

  private renderSettingsPage = (): JSX.Element => {
    return <SettingsPage rocketMethodCall={this.rocketMethodCall} />;
  }

  private renderInfo = () => {
    const bottomForIphone = this.state.isIPhoneX ? "iphone-margin-bottom" : "";
    if (!this.loggedIn) {
      switch (this.props.rocketConnectState) {
        case RocketConnectState.Connecting:
        case RocketConnectState.Open:
          return (
            <div className={`info ${bottomForIphone}`}>
              {wordings.currentLang.connecting}
            </div>
          );
        case RocketConnectState.Closed:
          return (
            <div className={`info ${bottomForIphone}`}>
              <div>{wordings.currentLang.connectFail}</div>
              <div>
                <button onClick={this.reconnect}>
                  {wordings.currentLang.reconnect}
                </button>
              </div>
            </div>
          );
        case RocketConnectState.LoginFail:
          return (
            <div className={`info ${bottomForIphone}`}>
              <div>{wordings.currentLang.loginFail}</div>
              <div>
                <button onClick={this.relogin}>
                  {wordings.currentLang.retryLogin}
                </button>
              </div>
            </div>
          );
        default:
          return null;
      }
    }
    return null;
  }

  private onRocketConnectStateChanged = (state: RocketConnectState): void => {
    this.props.setRocketConnectState(state);
    if (state === RocketConnectState.LoggedIn) {
      this.loggedIn = true;
      this.props.setRocketClientInfo(this.rocketClient);
      this.rocketMethodCall.getProjects();
      this.initState = INIT_STATE.LOADING_FRESH;
      this.rocketMethodCall.getUnreads();
      this.rocketSubscribe.subscribeRoom(this.props.authInfo.userid);
      const roomId = this.getRoomIdFromPath();

      this.rocketSubscribe.subscribeRoomLastMessage(this.props.authInfo.userid);

      if (roomId) {
        this.rocketSubscribe.subscribe([roomId]); // quick fix about subscription happening too late
      }

      this.setVisibilityChangeEvent();
      this.setOnlineEvent();
      this.rocketClient.setOnlineStatus(!document.hidden);
    }
  }

  private setVisibilityChangeEvent = () => {
    document.removeEventListener(
      "visibilitychange",
      this.handleVisibilityChange,
    );
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  private handleVisibilityChange = () => {
    this.rocketClient.setOnlineStatus(!document.hidden);
  }

  private setOnlineEvent = () => {
    window.removeEventListener(
      "online",
      this.rocketClient.handleOnlineStatusChange,
    );
    window.removeEventListener(
      "offline",
      this.rocketClient.handleOnlineStatusChange,
    );
    window.addEventListener(
      "online",
      this.rocketClient.handleOnlineStatusChange,
    );
    window.addEventListener(
      "offline",
      this.rocketClient.handleOnlineStatusChange,
    );
  }

  private messageAdded = (message: any): void => {
    this.props.addMessage(message);
    const project = this.props.project.projects.find(
      (el) => el.id === message.rid,
    );
    const roomName = (project && project.roomName) || "";
    sendNotification(roomName, message, this.props.authInfo.displayName);
  }

  private messageFailed = (
    message: string,
    rid: string,
    attachments: any,
  ): void => {
    const msg = {
      _id: generateHash(),
      _updatedAt: { $date: new Date().getTime() },
      attachments,
      error: true,
      msg: message,
      rid,
      ts: { $date: new Date().getTime() },
      u: {
        _id: this.props.authInfo.userid,
        name: this.props.authInfo.displayName,
        username: this.props.authInfo.username,
      },
    };
    this.messageAdded(msg);
  }

  private projectsLoaded = (
    rooms: IRoom[],
    isCache: boolean,
    customFields: IProjectCustomFields,
  ): void => {
    if (isCache) {
      switch (this.initState) {
        case INIT_STATE.LOADED_FRESH: {
          // ignore cache
          return;
        }
        default:
          this.initState = INIT_STATE.LOADED_CACHE;
          break;
      }
    } else {
      this.initState = INIT_STATE.LOADED_FRESH;
    }
    for (const room of rooms) {
      const connected =
        this.rocketClient.ConnectingState === RocketConnectState.LoggedIn;
      if (room.rid === this.getRoomIdFromPath()) {
        if (room.unread !== 0) {
          this.rocketMethodCall.markAsRead(room.rid, config.useRcBot);
          room.unread = 0;
        }
        if (connected && room.messagesCount) {
          this.rocketMethodCall.loadHistory(room.messagesCount, room.rid, null);
        }
        if (connected) {
          this.rocketSubscribe.subscribe([room.rid]);
        }
      }
    }
    this.props.getProjects(rooms, customFields);
    this.setState({ projectLoaded: true });
  }

  private projectAdded = async (room: IRoom) => {
    this.rocketSubscribe.subscribe([room.rid]);
    try {
      const response = await this.rocketMethodCall.fetchProjectInfo(room.rid);
      const customFields = response.data.group.customFields;
      this.props.addProject(room, customFields);
    } catch (err) {
      this.props.addProject(room, {});
    }
  }

  private onLoadUnreads = (rooms: any) => {
    this.props.getUnreads(rooms);
  }

  private getAuthInfoFromCookie = (): IAuthInfoState | null => {
    const rcsi = this.props.cookies.get("rcsi");
    return rcsi
      ? {
          displayName: rcsi.displayName || "",
          rocketAccess: rcsi.token || "",
          userid: rcsi.uid || "",
          username: rcsi.name || "",
        }
      : null;
  }

  private getAuthInfoFromDev(): IAuthInfoState {
    return {
      displayName: config.devRocketChatDisplayName || "",
      rocketAccess: config.devRocketChatUserToken || "",
      userid: config.devRocketChatUserId || "",
      username: config.devRocketChatUserName || "",
    };
  }

  private loginAndConnect(): void {
    const authInfo = this.getAuthInfoFromCookie() || this.getAuthInfoFromDev();
    if (!authInfo.rocketAccess) {
      if (this.props.location.pathname.indexOf("error") !== -1) {
        this.onRocketConnectStateChanged(RocketConnectState.NotApplicable);
        return;
      }
      this.redirectOAuth();
    }
    const eventHandler: IRocketEventHandler = {
      onAddProject: this.projectAdded,
      onDeleteProject: (roomId: string) => {
        const { pathname } = this.props.location;
        if (pathname === `/chat/${roomId}`) {
          const url = appName || "/";
          window.location.replace(url);
        }
        this.props.deleteProject(roomId);
      },
      onHistoryLoaded: (messages: any, roomId: string) => {
        this.props.getHistory(messages, roomId);
      },
      onLastMessageUpdate: (message: any) => {
        this.props.updateLastMessage(message);
      },
      onLoadProjects: this.projectsLoaded,
      onLoadSettings: this.settingsLoaded,
      onLoadUnreads: this.onLoadUnreads,
      onMessages: this.messageAdded,
      onSendFail: this.messageFailed,
      onStateChanged: this.onRocketConnectStateChanged,
      onUnreadUpdate: (roomId: string, unread: number) => {
        if (roomId === this.getRoomIdFromPath() && unread !== 0) {
          this.rocketMethodCall.markAsRead(roomId, config.useRcBot);
          this.props.updateUnread(roomId, 0);
        } else {
          this.props.updateUnread(roomId, unread);
        }
      },
      onUploadProgress: () => {
        /* empty */
      },
    };
    if (authInfo.rocketAccess && authInfo.username && authInfo.userid) {
      this.props.setAuthInfo(
        authInfo.rocketAccess,
        authInfo.username,
        authInfo.displayName,
        authInfo.userid,
      );
      Mixpanel.setUser(authInfo);

      // 2 vars are set in index.html,
      // var initializedWS which is socket trying to connect and login
      // var preLoginState which indicate whether it is logged in or not
      // var requests which contain the login request
      const customWindowVar: any = window as any;

      this.rocketClient = new RocketClient(
        `${config.rocketChatServerProtocol.ws}${config.rocketChatServerDomain}/websocket`,
        authInfo.userid,
        authInfo.rocketAccess,
        eventHandler,
        customWindowVar.initializedWS,
        customWindowVar.preLoginState,
        customWindowVar.requests,
      );
      this.rocketMethodCall = new MethodCallApi(this.rocketClient);
      this.rocketSubscribe = new SubscriptionApi(this.rocketClient);
      if (config.useRcBot) {
        this.rocketMethodCall.getProjectsCache();
        this.initState = INIT_STATE.LOADING_CACHE;
      } else {
        this.rocketMethodCall.getProjects();
        this.initState = INIT_STATE.LOADING_FRESH;
      }
      if (customWindowVar.preLoginState === RocketConnectState.LoggedIn) {
        this.props.authInfo.rocketAccess = authInfo.rocketAccess;
        this.props.authInfo.username = authInfo.username;
        this.props.authInfo.displayName = authInfo.displayName;
        this.props.authInfo.userid = authInfo.userid;
        this.onRocketConnectStateChanged(RocketConnectState.LoggedIn);
      }
      if (customWindowVar.preLoginState === RocketConnectState.LoginFail) {
        this.onRocketConnectStateChanged(RocketConnectState.LoginFail);
      }
    }
  }

  private settingsLoaded = (settings: any): void => {
    this.props.getSettings(settings);
  }

  private reconnect = (): void => {
    this.rocketClient.reconnect();
  }

  private relogin = (): void => {
    this.redirectOAuth();
  }

  private redirectOAuth = (): void => {
    const userAgent = navigator.userAgent || navigator.vendor;
    const oauthPath =
      userAgent.indexOf("MicroMessenger") !== -1
        ? config.oauthLoginPath
        : config.oauthLdapLoginPath;
    if (this.props.location.pathname.indexOf(`${routes.chat}/`) !== -1) {
      window.location.href = `${oauthPath}?roomId=${this.getRoomIdFromPath()}`;
    } else {
      window.location.href = oauthPath;
    }
  }

  private getRoomIdFromPath = (): string => {
    return this.props.location.pathname.substring(
      this.props.location.pathname.lastIndexOf("/") + 1,
    );
  }
}

export default withCookies(
  withRouter(
    connect(
      mapStateToProps,
      mapDispatchToProps,
    )(App),
  ),
);
