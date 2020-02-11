import { clearAllBodyScrollLocks, disableBodyScroll } from "body-scroll-lock";
import * as React from "react";
import { connect } from "react-redux";
import { RouteComponentProps, withRouter } from "react-router-dom";
import { Progress } from "reactstrap";
import { enableSearch, hideKeyboardOnSend, useRcBot } from "../../config";
import {
  appName,
  CHAT_OFFSET,
  IPHONEX_PADDING_BOTTOM,
  MAX_ATTACHMENT_SIZE,
} from "../../constants";
import {
  AUDIO_MESSAGE_FAILED,
  CLICK_SEND_MESSAGE,
  HIDE_AUDIO_RECORD,
  HOLD_AUDIO_RECORD,
  SENT_AUDIO_MESSAGE_SUCCESS,
  SHOW_AUDIO_RECORD,
  STOP_AUDIO_RECORD,
} from "../../constants/mixpanel";
import { query, routes } from "../../constants/routes";
import { resetSearch } from "../../store/actions";
import {
  IProjectCustomFields,
  IProjectSearchResult,
} from "../../store/definitions/";
import { IMessage } from "../../store/definitions/chat";
import Mixpanel from "../../util/mixpanel";
import { Recorder, RecorderAction, RecorderEvent } from "../../util/recorder";
import { voiceCaptureErrorMsg } from "../../util/recorder/recorderError";
import { generateHash } from "../../util/rocketchat/helper";
import { MethodCallApi } from "../../util/rocketchat/methodCallApi";
import { RocketClient } from "../../util/rocketchat/rocketClient";
import { SubscriptionApi } from "../../util/rocketchat/subscriptionApi";
import { RocketConnectState } from "../../util/rocketchat/types";
import {
  getMobileOperatingSystem,
  getWeWork,
  IOperatingSystem,
} from "../../util/system";
import { getWindowInfo, removeFilenameSpaces } from "../../util/utils";
import { wordings } from "../../wordings/Wordings";
import AlertModal from "../Common/AlertModal/AlertModal";
import Header from "../Common/Header/Header";
import PhotoModal from "../Common/PhotoModal/PhotoModal";
import Toast from "../Common/Toast/Toast";
import ChatInput from "./ChatInput/ChatInput";
import "./ChatPage.css";
import History from "./History/History";
import Preview from "./Preview/Preview";

interface IChatPageProps extends RouteComponentProps<any> {
  myDisplayName: string;
  currentUserId: string;
  chat: IMessage[];
  projectName: string;
  rocketClient: RocketClient;
  rocketMethodCall: MethodCallApi;
  rocketSubscription: SubscriptionApi;
  unread: any;
  currentRead: any;
  recorder: Recorder;
  searchResults: IProjectSearchResult[];
  displayName: string;
  customFields: IProjectCustomFields;
  clearSearch: () => void;
}

const mapStateToProps = (state: any, ownProps: any) => ({
  customFields: state.project.customFields,
  displayName: state.authInfo.displayName,
  searchResults: state.search.content.results,
});
const mapDispatchToProps = (dispatch: any) => ({
  clearSearch: () => resetSearch(dispatch),
});

class ChatPage extends React.Component<IChatPageProps, any> {
  private currentProjectId: string;
  private messagesInputRef: any;
  private conversationContainerRef: any;
  private messageContainerRef: any;
  private attachmentInputRef: any;
  private addMoreHistoryInterval: any;
  private highlightMessageRef: any;
  private scrollToBottomTimeout: NodeJS.Timeout | null = null;
  private scrollableElement: HTMLElement | null = null;
  private searchResult: IProjectSearchResult | null | undefined = null;
  private backRoute: string = "";
  private highlightId: string | null = null;
  private disableScrollBottom: boolean = false;
  private disableScrollBottomTimeout: NodeJS.Timeout | null = null;
  private resetVoiceCaptureTimeout: NodeJS.Timeout | null = null;
  private system: IOperatingSystem = getMobileOperatingSystem();
  private isWeWork: boolean = getWeWork();

  constructor(props: any) {
    super(props);
    const { isIPhoneX, internalHeight } = getWindowInfo();
    const marginBottom = isIPhoneX && !this.isWeWork ? 25 : 5;

    this.state = {
      addingHistory: false,
      attachments: [],
      chat: [],
      conversationHeight: {
        height: `${internalHeight}px`,
        top: "0px",
      },
      error: {
        icon: "fal fa-exclamation-triangle",
        msg: "",
      },
      fakeMessage: [],
      innerHeight: window.innerHeight,
      inputHeight: false,
      isIPhoneX,
      isRecording: false,
      isUploading: false,
      lastRecordedTime: 0,
      marginBottom,
      portraitHeight: internalHeight,
      searchResult: {
        id: "",
        index: 0,
      },
      showAlertModal: false,
      swipeToCancel: false,
      textInput: "",
      uploadFailed: false,
    };

    this.currentProjectId = this.props.match.params.projectId || "";
    this.messagesInputRef = React.createRef();
    this.conversationContainerRef = React.createRef();
    this.messageContainerRef = React.createRef();
    this.attachmentInputRef = React.createRef();
    this.highlightMessageRef = React.createRef();

    this.backRoute = appName;
  }

  public componentWillMount() {
    this.props.rocketMethodCall.loadHistory(0, this.currentProjectId, null);
    window.addEventListener("resize", this.resizeConversationContainer);
    document.addEventListener(
      "orientationchange",
      this.scrollToPosition,
      false,
    );
    document.addEventListener("visibilitychange", this.resetRecord, false);
    this.props.recorder.RecorderEvent.addListener(
      RecorderEvent.START_WECHAT_RECORD,
      this.startWechatRecordingHandler,
    );
    this.props.recorder.RecorderEvent.addListener(
      RecorderEvent.STOP_WECHAT_RECORD,
      this.stopWechatRecordingHandler,
    );
    this.props.recorder.RecorderEvent.addListener(
      RecorderEvent.SENT_WECHAT_VOICE,
      this.sentWechatVoiceHandler,
    );
    this.props.recorder.RecorderEvent.addListener(
      RecorderEvent.VOICE_RECORD_END,
      this.stopWechatRecordingHandler,
    );

    this.handleDocumentBodyOnScroll();

    if (
      this.props.rocketClient.ConnectingState === RocketConnectState.LoggedIn
    ) {
      this.props.rocketSubscription.subscribe([this.currentProjectId]);
    }
    const findHighlightId = this.props.location.search.match(
      new RegExp(`${query.highlightId}=([^&]*)`, "i"),
    );
    if (findHighlightId) {
      this.searchResult = this.props.searchResults.find(
        (result) => this.props.match.params.projectId === result.projectId,
      );
      let index = this.props.chat.findIndex((i) => i.id === findHighlightId[1]);
      index = index < 0 ? 0 : index;
      const id = findHighlightId[1];
      this.highlightId = id;
      this.disableScrollBottom = true;

      this.setState({
        searchResult: {
          id,
          index,
        },
      });
    }
    this.backRoute = this.searchResult
      ? this.searchResult.matches.length > 1
        ? `${routes.search}/${this.props.match.params.projectId}`
        : routes.search
      : appName;
  }

  public componentDidMount() {
    this.scrollToPosition();
    this.props.rocketClient.RocketEventHandler.onUploadProgress = this.updateUploadProgress;
    if (this.props.currentRead !== 0) {
      this.props.rocketMethodCall.markAsRead(this.currentProjectId, useRcBot);
    }
    document.body.style.backgroundColor = "#EDEDED";
    this.scrollableElement = document.querySelector("#scrollable");
    if (this.scrollableElement) {
      disableBodyScroll(this.scrollableElement);
    }
  }

  public componentWillReceiveProps(nextProps: any) {
    let chatHistory: any = [];
    if (nextProps.chat.length <= CHAT_OFFSET) {
      this.setState({
        chat: nextProps.chat,
      });
    } else if (this.props.chat.length + 1 === nextProps.chat.length) {
      chatHistory = this.processChatHistory(nextProps.chat, true);
      this.setState(
        (state: any) => ({
          chat: chatHistory,
        }),
        () => {
          this.scrollToBottom();
        },
      );
    } else if (nextProps.chat.length >= this.props.chat.length) {
      chatHistory = this.processChatHistory(nextProps.chat, false);
      this.setState((state: any) => ({
        chat: chatHistory,
      }));
    }
    if (this.state.uploadProgress !== nextProps.uploadProgress) {
      this.setState({
        uploadProgress: nextProps.uploadProgress,
      });
    }
  }

  public componentDidUpdate(prevProps: any, prevState: any) {
    if (
      prevState.chat.length < CHAT_OFFSET &&
      prevState.chat.length !== this.state.chat.length &&
      !this.disableScrollBottom &&
      !this.highlightId &&
      !this.state.addingHistory
    ) {
      this.scrollToBottom();
    }
    if (
      this.state.searchResult.id &&
      this.disableScrollBottom &&
      !this.state.addingHistory
    ) {
      this.scrollToHighlightMessage();
    }
    if (this.state.previousHeight > prevState.previousHeight) {
      const after = this.conversationContainerRef.current.scrollHeight;
      const offsetHeight = after - this.state.previousHeight - 100;
      if (offsetHeight !== 0) {
        this.conversationContainerRef.current.scrollTop = offsetHeight;
      }
      this.setState({
        addingHistory: false,
      });
    }

    if (this.state.addingHistory !== prevState.addingHistory) {
      this.setState({
        addingHistory: false,
      });
    }
  }

  public componentWillUnmount() {
    document.body.style.backgroundColor = "#FFF";
    clearTimeout(this.scrollToBottomTimeout as NodeJS.Timeout);
    clearTimeout(this.disableScrollBottomTimeout as NodeJS.Timeout);
    clearTimeout(this.resetVoiceCaptureTimeout as NodeJS.Timeout);
    clearTimeout(this.addMoreHistoryInterval as NodeJS.Timeout);
    clearAllBodyScrollLocks();
    window.removeEventListener("resize", this.resizeConversationContainer);
    document.removeEventListener("orientationchange", this.scrollToPosition);
    document.removeEventListener("visibilitychange", this.resetRecord);
    if (this.state.uploadFailed) {
      this.setState({
        isUploading: false,
        swipeToCancel: false,
        uploadFailed: false,
      });
    }
    this.props.recorder.RecorderEvent.removeListener(
      RecorderEvent.START_WECHAT_RECORD,
      this.startWechatRecordingHandler,
    );
    this.props.recorder.RecorderEvent.removeListener(
      RecorderEvent.STOP_WECHAT_RECORD,
      this.stopWechatRecordingHandler,
    );
    this.props.recorder.RecorderEvent.removeListener(
      RecorderEvent.SENT_WECHAT_VOICE,
      this.sentWechatVoiceHandler,
    );
    this.props.recorder.RecorderEvent.removeListener(
      RecorderEvent.VOICE_RECORD_END,
      this.stopWechatRecordingHandler,
    );

    document.body.onscroll = null;
  }

  public render() {
    let wxReady = false;
    const updatingHistory = this.state.addingHistory ? "no-scroll" : "";
    if (!this.props.recorder.errorMsg && this.props.recorder.isReady) {
      wxReady = true;
    }
    return (
      <div className="chat-page">
        <Header
          backRoute={this.backRoute}
          unread={this.props.unread}
          title={this.props.projectName}
          searchButton={enableSearch}
          searchParam={this.currentProjectId}
          clearSearch={this.props.clearSearch}
        />
        {this.state.uploadProgress >= 1 && (
          <Progress value={this.state.uploadProgress} />
        )}

        <div
          className={`conversation-container disable-dbl-tap-zoom ${updatingHistory}`}
          ref={this.conversationContainerRef}
          style={this.state.conversationHeight}
          onTouchStartCapture={this.onTouch}
          id="scrollable"
          onScroll={this.handleScroll}
        >
          <History
            messages={this.state.chat}
            myDisplayName={this.props.myDisplayName}
            projectId={this.currentProjectId}
            rocketMethodCall={this.props.rocketMethodCall}
            highlightId={this.highlightId}
            recorder={this.props.recorder}
            setHighlightMessageRef={this.setHighlightMessageRef}
            scrollContainerRef={this.conversationContainerRef}
            fakeMessage={this.state.fakeMessage}
          />
        </div>

        <ChatInput
          inputHeight={this.state.inputHeight}
          wxReady={wxReady}
          messageContainerRef={this.messageContainerRef}
          scrollContainerRef={this.conversationContainerRef}
          updateInputSize={this.updateInputSize}
          handleFocus={this.handleFocus}
          handleBlur={this.handleBlur}
          messagesInputRef={this.messagesInputRef}
          updateInput={this.updateInput}
          trackAudio={this.trackAudio}
          toggleAudio={this.toggleAudio}
          attachmentInputRef={this.attachmentInputRef}
          handleFileCapture={this.handleFileCapture}
          clickedSend={this.clickedSend}
          textInput={this.state.textInput}
          marginBottom={this.state.marginBottom}
          isRecording={this.state.isRecording}
          isUploading={this.state.isUploading}
          isLoading={
            this.state.uploadProgress >= 1 || this.state.isUploading
              ? true
              : false
          }
          isIPhoneX={this.state.isIPhoneX}
          uploadFailed={this.state.uploadFailed}
          lastRecordedTime={this.lastRecordedTime}
        />

        <Preview
          attachments={this.state.attachments}
          discardAttachment={this.discardAttachment}
          clickedSend={this.clickedSend}
          recorder={this.props.recorder}
        />
        <PhotoModal />
        <AlertModal
          showModal={this.state.showAlertModal}
          title={wordings.currentLang.attachmentSizeErrorTitle}
          body={wordings.currentLang.attachmentSizeErrorBody}
          close={this.closeAlertModal}
        />
        {this.state.swipeToCancel && !this.state.uploadFailed && (
          <Toast
            displayText={wordings.currentLang.swipeToCancel}
            displaySecondaryText={wordings.currentLang.countText}
            displayIcon="fas fa-undo"
            lastRecordedTime={this.state.lastRecordedTime}
            error={false}
          />
        )}
        {this.state.uploadFailed && (
          <Toast
            displayText={this.state.error.msg}
            displayIcon={this.state.error.icon}
            error={true}
          />
        )}
      </div>
    );
  }
  private lastRecordedTime = (time: any) => {
    this.setState({
      lastRecordedTime: time,
    });
  }

  private handleDocumentBodyOnScroll = () => {
    document.body.onscroll = () => {
      if (
        document.body.scrollTop !== 0 &&
        document.body.scrollTop !== window.innerHeight
      ) {
        if (this.state.innerHeight !== window.innerHeight) {
          window.scrollTo(0, document.body.scrollHeight);
          document.body.scrollTop = document.body.scrollHeight;
          this.setState({ innerHeight: window.innerHeight });
        }
      }
    };
  }

  private processChatHistory = (chatHistory = [], newMessage: boolean) => {
    const immutableObj: any = chatHistory;
    const length: number = chatHistory.length;
    let adjustment: number = length - this.state.searchResult.index;
    if (this.state.searchResult.id) {
      const index = this.props.chat.findIndex(
        (i) => i.id === this.state.searchResult.id,
      );
      adjustment = length - index;
    }

    let firstPart: any;
    if (!newMessage && adjustment <= CHAT_OFFSET) {
      const begin = length - CHAT_OFFSET;
      firstPart = immutableObj.slice(begin, length);
      return firstPart;
    }
    if (!newMessage && this.state.chat.length < CHAT_OFFSET) {
      const offset =
        length === adjustment
          ? length - CHAT_OFFSET
          : chatHistory.length - adjustment - 5;
      const start = offset >= 0 ? offset : 0;
      firstPart = immutableObj.slice(start, length);
      return firstPart;
    }
    if (newMessage) {
      const currentState: any = chatHistory.slice(
        chatHistory.length - this.state.chat.length,
        chatHistory.length,
      );
      return currentState;
    }

    return this.state.chat;
  }

  private getMoreHistory = () => {
    if (
      !this.state.chat.length &&
      this.props.chat.length &&
      this.state.searchResult.index
    ) {
      const newArray: any = this.props.chat;
      const chatHistory: any = this.processChatHistory(newArray, false);
      this.setState({
        chat: chatHistory || this.props.chat,
      });
    } else {
      this.props.rocketMethodCall.loadHistory(0, this.currentProjectId, null);
      this.addMoreHistoryInterval = setInterval(() => {
        const adjustment =
          this.state.chat.length - this.state.searchResult.index;
        if (this.state.chat >= adjustment) {
          this.scrollToHighlightMessage();
        }
      }, 1500);
    }
  }

  private handleScroll = (event: any) => {
    if (
      this.conversationContainerRef &&
      this.conversationContainerRef.current &&
      (this.state.chat.length >= CHAT_OFFSET ||
        this.props.chat.length >= CHAT_OFFSET) &&
      !this.state.addingHistory
    ) {
      event.preventDefault();
      const scrollContainer = event.target;
      if (scrollContainer.scrollTop <= 100) {
        if (this.state.chat.length < this.props.chat.length) {
          const previousHistory = this.state.chat;
          const nextHistory = this.props.chat;
          const end = nextHistory.length - previousHistory.length;
          const offset = end >= CHAT_OFFSET ? CHAT_OFFSET : end;
          const newEnd = end - offset;
          const nextPart = nextHistory.slice(newEnd, end);
          const newhistory = nextPart.concat(this.state.chat);
          const before = scrollContainer.scrollHeight;
          this.setState({
            addingHistory: true,
            chat: newhistory,
            previousHeight: before,
            searchResult: {
              id: "",
              index: 0,
            },
          });
        }
      }
    }
  }

  private resetUploadFailed = () => {
    if (this.state.uploadFailed) {
      this.setState({
        error: {
          icon: "fal fa-exclamation-triangle",
          msg: "",
        },
        uploadFailed: false,
      });
    }
  }

  private toggleSwipe = (state: boolean) => {
    this.setState({
      swipeToCancel: state || !this.state.swipeToCancel,
    });
  }

  private resizeConversationContainer = () => {
    let internalHeight: number = 0;
    if (window.orientation === 0 && this.system === IOperatingSystem.iOS) {
      internalHeight = this.state.portraitHeight;
    } else {
      internalHeight = getWindowInfo().internalHeight;
    }
    this.setState({
      conversationHeight: {
        height: `${internalHeight}px`,
        top: "0px",
      },
    });
  }

  private scrollToPosition = () => {
    if (this.highlightId && this.disableScrollBottom) {
      this.scrollToHighlightMessage();
    } else if (!this.disableScrollBottom) {
      this.scrollToBottom();
    }
  }

  private handleFileCapture = (event: any) => {
    const files: any = event.target.files;
    if (files && files[0]) {
      if (files[0].size < MAX_ATTACHMENT_SIZE) {
        const reader = new FileReader();
        reader.onload = files;
        reader.readAsDataURL(files[0]);
        reader.onload = () => {
          const renamedFile = new File(
            [files[0]],
            removeFilenameSpaces(files[0].name),
            {
              type: files[0].type,
            },
          );
          const newAttachment = [
            {
              data_type: files[0].type,
              file: renamedFile,
              name: renamedFile.name,
              src: reader.result,
              type: renamedFile.type.split("/")[0],
            },
          ];

          const attach = this.state.attachments.concat(newAttachment);
          this.setState(
            {
              attachments: attach,
            },
            () => {
              if (newAttachment[0].type === "video") {
                this.clickedSend();
              }
            },
          );
        };
      } else {
        this.setState({ showAlertModal: true });
      }
    }
  }

  private onTouch = () => {
    if (this.messagesInputRef && this.messagesInputRef.current) {
      this.messagesInputRef.current._ref.blur();
    }
  }

  private resetRecord = () => {
    this.props.recorder.cancelRecording();
    this.setState({
      attachments: [],
      error: {
        icon: "fal fa-exclamation-triangle",
        msg: "",
      },
      isRecording: false,
      swipeToCancel: false,
      uploadFailed: false,
    });
  }

  private getError = (err: any) => {
    const defaultError = {
      icon: "fal fa-exclamation-triangle",
      msg: wordings.currentLang.uploadFailed,
    };
    if (err.code) {
      return err.code === "ECONNABORTED" || !navigator.onLine
        ? {
            icon: "fal fa-wifi-slash",
            msg: wordings.currentLang.networkError,
          }
        : defaultError;
    }
    if (err.errMsg) {
      switch (err.errMsg) {
        case voiceCaptureErrorMsg.tooShort:
          return {
            icon: "fal fa-exclamation-circle",
            msg: wordings.currentLang.voiceTooShort,
          };
        case voiceCaptureErrorMsg.permissionDenied:
          return {
            icon: "fal fa-exclamation-circle",
            msg: wordings.currentLang.permissionDenied,
          };
        default:
          return defaultError;
      }
    }
    return defaultError;
  }
  private handleVoiceCaptureError = (err: any) => {
    clearTimeout(this.resetVoiceCaptureTimeout as NodeJS.Timeout);
    this.resetVoiceCaptureTimeout = setTimeout(this.resetUploadFailed, 3000);
    const uploadFailed =
      err.errMsg === voiceCaptureErrorMsg.permissionDenied ? false : true;
    this.setState(
      (state: any) => ({
        attachments: [],
        error: this.getError(err),
        fakeMessage: [],
        isRecording: false,
        isUploading: false,
        lastRecordedTime: 0,
        swipeToCancel: false,
        textInput: "",
        uploadFailed,
      }),
      () => {
        this.scrollToBottom();
      },
    );
    Mixpanel.track(AUDIO_MESSAGE_FAILED, {
      "CM Id":
        this.currentProjectId && this.props.customFields[this.currentProjectId]
          ? this.props.customFields[this.currentProjectId].cmId
          : "",
      "Consultation Id":
        this.currentProjectId && this.props.customFields[this.currentProjectId]
          ? this.props.customFields[this.currentProjectId].consultationId
          : "",
      "Error": err.errMsg || err,
      "Name": this.props.displayName,
      "projectId": this.currentProjectId,
      "projectName": this.props.projectName,
    });
  }

  private startWechatRecordingHandler = (err: any) => {
    if (err) {
      this.handleVoiceCaptureError({ errMsg: voiceCaptureErrorMsg.tooShort });
    }
  }

  private stopWechatRecordingHandler = (file: any, e: any) => {
    if (e || document.hidden) {
      this.handleVoiceCaptureError(e);
      return;
    }
    const timer =
      this.state.lastRecordedTime >= 60
        ? "1:00"
        : `${this.state.lastRecordedTime}"`;
    const fakeMessage = [
      {
        attachments: file,
        content: `${timer}`,
        error: false,
        id: generateHash(),
        name: this.props.displayName,
        t: undefined,
        timeStamp: Date.now(),
        url: [],
        urlFound: false,
      },
    ];
    Mixpanel.track(SENT_AUDIO_MESSAGE_SUCCESS, {
      "CM Id":
        this.currentProjectId && this.props.customFields[this.currentProjectId]
          ? this.props.customFields[this.currentProjectId].cmId
          : "",
      "Consultation Id":
        this.currentProjectId && this.props.customFields[this.currentProjectId]
          ? this.props.customFields[this.currentProjectId].consultationId
          : "",
      "Duration": timer,
      "Name": this.props.displayName,
      "projectId": this.currentProjectId,
      "projectName": this.props.projectName,
    });
    this.setState(
      (state: any) => ({
        fakeMessage,
        isRecording: false,
        isUploading: true,
        lastRecordedTime: 0,
        swipeToCancel: false,
        uploadFailed: false,
      }),
      () => {
        this.scrollToBottom();
      },
    );
    this.props.recorder.sendWeChatmessage(
      file,
      this.currentProjectId,
      this.props.currentUserId,
    );
    if (this.highlightId) {
      delete this.highlightId;
    }
  }

  private sentWechatVoiceHandler = (data: any, e: any) => {
    if (e) {
      this.handleVoiceCaptureError(e);
      return;
    }

    this.setState(
      (state: any) => ({
        attachments: [],
        fakeMessage: [],
        isRecording: false,
        isUploading: false,
        lastRecordedTime: 0,
        textInput: "",
      }),
      () => {
        this.scrollToBottom();
      },
    );
  }
  private trackAudio = (state: any, setRecorderAction: RecorderAction) => {
    switch (setRecorderAction) {
      case RecorderAction.IDLE: {
        const event = state ? HIDE_AUDIO_RECORD : SHOW_AUDIO_RECORD;
        Mixpanel.track(event, {
          "Action": setRecorderAction,
          "CM Id":
            this.currentProjectId &&
            this.props.customFields[this.currentProjectId]
              ? this.props.customFields[this.currentProjectId].cmId
              : "",
          "Consultation Id":
            this.currentProjectId &&
            this.props.customFields[this.currentProjectId]
              ? this.props.customFields[this.currentProjectId].consultationId
              : "",
          "Message": state,
          "Name": this.props.displayName,
          "projectId": this.currentProjectId,
          "projectName": this.props.projectName,
        });
        break;
      }
      case RecorderAction.START: {
        Mixpanel.track(HOLD_AUDIO_RECORD, {
          "Action": setRecorderAction,
          "CM Id":
            this.currentProjectId &&
            this.props.customFields[this.currentProjectId]
              ? this.props.customFields[this.currentProjectId].cmId
              : "",
          "Consultation Id":
            this.currentProjectId &&
            this.props.customFields[this.currentProjectId]
              ? this.props.customFields[this.currentProjectId].consultationId
              : "",
          "Message": state,
          "Name": this.props.displayName,
          "projectId": this.currentProjectId,
          "projectName": this.props.projectName,
        });
        break;
      }
      case RecorderAction.STOP: {
        Mixpanel.track(STOP_AUDIO_RECORD, {
          "Action": setRecorderAction,
          "CM Id":
            this.currentProjectId &&
            this.props.customFields[this.currentProjectId]
              ? this.props.customFields[this.currentProjectId].cmId
              : "",
          "Consultation Id":
            this.currentProjectId &&
            this.props.customFields[this.currentProjectId]
              ? this.props.customFields[this.currentProjectId].consultationId
              : "",
          "Message": state,
          "Name": this.props.displayName,
          "projectId": this.currentProjectId,
          "projectName": this.props.projectName,
        });
        break;
      }
      default: {
        break;
      }
    }
  }

  private toggleAudio = (setRecorderAction: RecorderAction) => {
    switch (setRecorderAction) {
      case RecorderAction.IDLE:
        this.resetRecord();
        return;
      case RecorderAction.START:
        const start = this.props.recorder.startRecording();
        if (!start) {
          this.setState({
            error: {
              icon: "fal fa-wifi-slash",
              msg: wordings.currentLang.networkError,
            },
            isRecording: false,
            lastRecordedTime: 0,
            swipeToCancel: false,
            uploadFailed: true,
          });
          this.trackAudio(
            wordings.currentLang.networkError,
            RecorderAction.ERROR,
          );
        } else {
          this.setState({
            isRecording: true,
            lastRecordedTime: 0,
            swipeToCancel: true,
            uploadFailed: false,
          });
          this.trackAudio("Start Recording", RecorderAction.START);
        }
        break;
      case RecorderAction.STOP:
        this.setState({
          isRecording: false,
        });
        this.props.recorder.stopWechatRecording();
        this.trackAudio("Recording Ended", RecorderAction.STOP);
        break;
      default:
        break;
    }
  }

  private setHighlightMessageRef = (ref: any, id: string) => {
    if (ref && this.highlightId === id) {
      this.highlightMessageRef = ref;
    }
  }

  private isHighlightedMessageLoaded = () =>
    this.props.chat.findIndex((i: any) => i.id === this.state.searchResult.id)

  private scrollToHighlightMessage = () => {
    if (this.highlightMessageRef && this.isHighlightedMessageLoaded() !== -1) {
      try {
        const highlightNode = document.querySelector(
          `#highlightId-${this.state.searchResult.id}`,
        ) as Element;
        if (highlightNode) {
          highlightNode.scrollIntoView({ block: "center" });
        } else {
          this.highlightMessageRef.scrollIntoView({ block: "center" });
        }
      } catch (e) {
        this.getMoreHistory();
      }

      this.disableScrollBottomTimeout = setTimeout(() => {
        this.disableScrollBottom = false;
      }, 2000);
    }
  }

  private handleFocus = () => {
    this.scrollToBottomWithDelay();
    if (this.state.isIPhoneX && !this.isWeWork) {
      this.setState({ marginBottom: 5 });
    }
  }

  private handleBlur = (evt?: any) => {
    if (this.state.isIPhoneX && !this.isWeWork) {
      this.setState({ marginBottom: IPHONEX_PADDING_BOTTOM });
    }
    this.scrollToBottomWithDelay();
  }

  private closeAlertModal = () => {
    this.discardAttachment();
    this.setState({ showAlertModal: false });
  }

  private discardAttachment = () => {
    if (this.attachmentInputRef.current) {
      this.attachmentInputRef.current.value = "";
    }
    this.setState({
      attachments: [],
    });
  }

  private updateUploadProgress = (progress: any): void => {
    this.setState({ uploadProgress: progress });
  }

  private scrollToBottom = () => {
    const scrollNode = this.conversationContainerRef.current;
    if (scrollNode) {
      window.scrollTo(0, document.body.scrollHeight);
      document.body.scrollTop = document.body.scrollHeight;
      const scrollHeight = scrollNode.scrollHeight;
      const height = scrollNode.clientHeight;
      const maxScrollTop = scrollHeight - height;
      scrollNode.scrollTop = maxScrollTop > 0 ? maxScrollTop : 0;
    }
  }

  private scrollToBottomWithDelay = () => {
    this.scrollToBottomTimeout = setTimeout(() => {
      this.scrollToBottom();
    }, 100);
  }

  private updateInputSize = () => {
    const input = this.messagesInputRef.current;
    switch (input.state.height) {
      case 34: {
        this.setState({
          conversationHeight: {
            height: this.state.conversationHeight.height,
            top: "0px",
          },
          inputHeight: false,
        });
        break;
      }
      case 58: {
        this.setState({
          conversationHeight: {
            height: this.state.conversationHeight.height,
            top: "-25px",
          },
          inputHeight: true,
        });
        break;
      }
      case 82: {
        this.setState({
          conversationHeight: {
            height: this.state.conversationHeight.height,
            top: "-50px",
          },
          inputHeight: true,
        });
        break;
      }
      case 106: {
        this.setState({
          conversationHeight: {
            height: this.state.conversationHeight.height,
            top: "-75px",
          },
          inputHeight: true,
        });
        break;
      }
      case 130: {
        this.setState({
          conversationHeight: {
            height: this.state.conversationHeight.height,
            top: "-100px",
          },
          inputHeight: true,
        });
        break;
      }
    }
  }

  private updateInput = (event: any) => {
    this.setState({ textInput: event.target.value });
  }

  private clickedSend = (e: any = null) => {
    if (!hideKeyboardOnSend) {
      e.preventDefault();
    }
    if (this.highlightId) {
      delete this.highlightId;
    }
    if (
      this.state.attachments.length &&
      this.state.attachments[0].type === "wechat"
    ) {
      if (!this.state.isUploading) {
        this.props.recorder.sendWeChatmessage(
          this.state.attachments,
          this.currentProjectId,
          this.props.currentUserId,
        );
        this.setState({
          attachments: [],
          isUploading: true,
          swipeToCancel: false,
          textInput: "",
        });
        this.backRoute = appName;
      }
      return;
    }

    if (this.state.textInput.trim() !== "" || this.state.attachments.length) {
      Mixpanel.track(CLICK_SEND_MESSAGE, {
        "CM Id":
          this.currentProjectId &&
          this.props.customFields[this.currentProjectId]
            ? this.props.customFields[this.currentProjectId].cmId
            : "",
        "Consultation Id":
          this.currentProjectId &&
          this.props.customFields[this.currentProjectId]
            ? this.props.customFields[this.currentProjectId].consultationId
            : "",
        "Name": this.props.displayName,
        "projectId": this.currentProjectId,
      });
      this.props.rocketMethodCall.sendMessage(
        this.state.textInput,
        this.currentProjectId,
        this.state.attachments,
      );
    }
    this.setState({
      attachments: [],
      textInput: "",
    });

    this.backRoute = appName;
  }
}
export default withRouter(
  connect(
    mapStateToProps,
    mapDispatchToProps,
  )(ChatPage),
);
